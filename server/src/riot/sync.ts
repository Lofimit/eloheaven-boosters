import { q } from "../db.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { normalizeServer, rankScore } from "../lib/league.js";
import { getSettings, state } from "../settings.js";
import { riot, RiotKeyError, type LeagueEntry } from "./api.js";
import { syncWithRefreshToken, TokenInvalidError } from "./legacyTokens.js";

interface SyncRow {
  id: number;
  server: string;
  riot_id: string;
  puuid: string | null;
  refresh_token_enc: string | null;
  token_status: string;
  riotid_synced_at: number | null;
}

export interface SyncResult {
  ok: boolean;
  message: string;
}

function rankFields(entries: LeagueEntry[]) {
  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  const flex = entries.find((e) => e.queueType === "RANKED_FLEX_SR");
  const pick = (e?: LeagueEntry) => ({
    tier: e?.tier ?? null,
    division: e ? (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(e.tier) ? null : e.rank) : null,
    lp: e?.leaguePoints ?? 0,
    wins: e?.wins ?? 0,
    losses: e?.losses ?? 0,
  });
  return { solo: pick(solo), flex: pick(flex) };
}

/** Refresh one account from the official Riot API (+ legacy token if enabled). */
export async function syncAccount(id: number): Promise<SyncResult> {
  const acc = q.get<SyncRow>(
    "SELECT id, server, riot_id, puuid, refresh_token_enc, token_status, riotid_synced_at FROM accounts WHERE id = ?",
    [id],
  );
  if (!acc) return { ok: false, message: "Account not found" };
  const server = normalizeServer(acc.server);
  if (!server) return fail(id, `Unknown server "${acc.server}"`);

  const now = Date.now();
  const notes: string[] = [];

  try {
    // 1. Resolve PUUID (once), and keep the Riot ID fresh (daily) since players can rename.
    let puuid = acc.puuid;
    if (!puuid) {
      const a = await riot.accountByRiotId(server, acc.riot_id);
      if (!a) return fail(id, `Riot ID "${acc.riot_id}" not found on ${server.toUpperCase()}`);
      puuid = a.puuid;
      q.run("UPDATE accounts SET puuid = ?, riotid_synced_at = ? WHERE id = ?", [puuid, now, id]);
    } else if (!acc.riotid_synced_at || now - acc.riotid_synced_at > 86400_000) {
      const a = await riot.accountByPuuid(server, puuid);
      if (a?.gameName && a.tagLine) {
        const fresh = `${a.gameName}#${a.tagLine}`;
        const clash = q.get("SELECT id FROM accounts WHERE server = ? AND riot_id = ? COLLATE NOCASE AND id != ?", [acc.server, fresh, id]);
        if (!clash) q.run("UPDATE accounts SET riot_id = ?, riotid_synced_at = ? WHERE id = ?", [fresh, now, id]);
      } else {
        q.run("UPDATE accounts SET riotid_synced_at = ? WHERE id = ?", [now, id]);
      }
    }

    // 2. Level / icon, 3. Ranked entries, 4. Live game.
    const summoner = await riot.summoner(server, puuid);
    const entries = (await riot.leagues(server, puuid)) ?? [];
    const inGame = await riot.inGame(server, puuid);
    const { solo, flex } = rankFields(entries);

    q.run(
      `UPDATE accounts SET
        level = COALESCE(?, level), profile_icon = COALESCE(?, profile_icon),
        solo_tier = ?, solo_division = ?, solo_lp = ?, solo_wins = ?, solo_losses = ?, solo_score = ?,
        flex_tier = ?, flex_division = ?, flex_lp = ?, flex_wins = ?, flex_losses = ?, flex_score = ?,
        in_game = ?, rank_synced_at = ?, sync_error = NULL, updated_at = ?
       WHERE id = ?`,
      [
        summoner?.summonerLevel ?? null, summoner?.profileIconId ?? null,
        solo.tier, solo.division, solo.lp, solo.wins, solo.losses, rankScore(solo.tier, solo.division, solo.lp),
        flex.tier, flex.division, flex.lp, flex.wins, flex.losses, rankScore(flex.tier, flex.division, flex.lp),
        inGame ? 1 : 0, now, now, id,
      ],
    );
  } catch (err) {
    if (err instanceof RiotKeyError) throw err;
    return fail(id, (err as Error).message);
  }

  // Optional: deprecated token path. Expected to fail for most accounts.
  if (getSettings().legacyTokenSync && acc.refresh_token_enc && acc.token_status !== "invalid") {
    try {
      const data = await syncWithRefreshToken(server, decrypt(acc.refresh_token_enc));
      q.run(
        `UPDATE accounts SET
          refresh_token_enc = ?, token_status = 'ok', store_synced_at = ?,
          be = COALESCE(?, be), rp = COALESCE(?, rp), refunds = COALESCE(?, refunds),
          champions = COALESCE(?, champions), champion_count = COALESCE(?, champion_count),
          banned = COALESCE(?, banned), ban_info = CASE WHEN ? IS NULL THEN ban_info ELSE ? END
         WHERE id = ?`,
        [
          encrypt(data.refreshToken), now,
          data.be ?? null, data.rp ?? null, data.refunds ?? null,
          data.champions ? JSON.stringify(data.champions) : null, data.champions?.length ?? null,
          data.banned === undefined ? null : data.banned ? 1 : 0,
          data.banned === undefined ? null : 1, data.banInfo ?? null,
          id,
        ],
      );
      notes.push("store data synced via token");
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        q.run("UPDATE accounts SET token_status = 'invalid' WHERE id = ?", [id]);
        notes.push("legacy token invalid (expected)");
      }
    }
  }

  return { ok: true, message: ["Rank synced", ...notes].join(", ") };
}

function fail(id: number, message: string): SyncResult {
  q.run("UPDATE accounts SET sync_error = ?, rank_synced_at = ? WHERE id = ?", [message.slice(0, 300), Date.now(), id]);
  return { ok: false, message };
}

/* ---------------------------------- jobs ---------------------------------- */

export interface RefreshRunStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  done: number;
  total: number;
  failed: number;
  lastError: string | null;
}

let run: RefreshRunStatus = state.get<RefreshRunStatus>("refreshRun") ?? {
  running: false, startedAt: null, finishedAt: null, done: 0, total: 0, failed: 0, lastError: null,
};
run.running = false; // a crash mid-run must not leave it stuck
export const refreshStatus = () => run;

/** Refresh every active account, oldest data first. Safe to call concurrently (no-op if running). */
export async function refreshAll(): Promise<void> {
  if (run.running) return;
  const ids = q.all<{ id: number }>("SELECT id FROM accounts WHERE active = 1 ORDER BY COALESCE(rank_synced_at, 0) ASC").map((r) => r.id);
  run = { running: true, startedAt: Date.now(), finishedAt: null, done: 0, total: ids.length, failed: 0, lastError: null };
  try {
    for (const id of ids) {
      const r = await syncAccount(id);
      run.done++;
      if (!r.ok) {
        run.failed++;
        run.lastError = `#${id}: ${r.message}`;
      }
    }
  } catch (err) {
    run.lastError = (err as Error).message;
  } finally {
    run.running = false;
    run.finishedAt = Date.now();
    state.set("refreshRun", run);
  }
}

/** Live-game check for accounts currently in use (keeps leases alive while playing). */
export async function refreshInGame(): Promise<void> {
  if (run.running) return;
  const rows = q.all<{ id: number; server: string; puuid: string }>(
    "SELECT id, server, puuid FROM accounts WHERE in_use_by IS NOT NULL AND puuid IS NOT NULL",
  );
  for (const r of rows) {
    const server = normalizeServer(r.server);
    if (!server) continue;
    try {
      const inGame = await riot.inGame(server, r.puuid);
      q.run("UPDATE accounts SET in_game = ? WHERE id = ?", [inGame ? 1 : 0, r.id]);
    } catch (err) {
      if (err instanceof RiotKeyError) return;
    }
  }
}
