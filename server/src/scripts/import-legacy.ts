/**
 * One-shot migration from the old MySQL database (eloheaven-be) into SQLite.
 *
 *   LEGACY_DATABASE_URL=mysql://user:pass@host:3306/dbname node dist/scripts/import-legacy.js [--force]
 *
 * Preserves user and account IDs. Credentials are encrypted with APP_SECRET on the way in.
 * Safe to run against a fresh install only (refuses if users exist, unless --force).
 */
import mysql from "mysql2/promise";
import { q, tx } from "../db.js";
import { encrypt, newClientKey } from "../lib/crypto.js";
import { normalizeServer, parseLegacyRank, rankScore, type Role } from "../lib/league.js";
import { championByName, getDDragon } from "../riot/ddragon.js";

const url = process.env.LEGACY_DATABASE_URL;
if (!url) {
  console.error("Set LEGACY_DATABASE_URL=mysql://user:pass@host:3306/db");
  process.exit(1);
}
const force = process.argv.includes("--force");
if (!force && q.get("SELECT 1 FROM users LIMIT 1")) {
  console.error("The new database already has users. Re-run with --force to merge anyway (existing IDs are skipped).");
  process.exit(1);
}

type Row = Record<string, any>;
/** Case-insensitive column getter: legacy columns mixed camelCase and PascalCase. */
const col = (r: Row, ...names: string[]) => {
  for (const n of names) {
    const k = Object.keys(r).find((key) => key.toLowerCase() === n.toLowerCase());
    if (k !== undefined && r[k] !== null && r[k] !== undefined) return r[k];
  }
  return null;
};
const ms = (v: unknown, fallback = Date.now()) => {
  if (!v) return fallback;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : fallback;
};
const jsonArr = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(String(v ?? "[]"));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};
const ROLE_MAP: Record<number, Role> = { 1: "owner", 2: "admin", 3: "moderator", 4: "customer", 5: "booster" };

await getDDragon(); // needed to map legacy champion names -> ids
const conn = await mysql.createConnection({ uri: url, dateStrings: true });
const tryQuery = async (sql: string): Promise<Row[]> => {
  try {
    const [rows] = await conn.query(sql);
    return rows as Row[];
  } catch (err) {
    console.warn(`  (skipped: ${(err as Error).message})`);
    return [];
  }
};

console.log("Reading legacy data…");
const users = await tryQuery("SELECT * FROM users");
const accounts = await tryQuery("SELECT * FROM leagueaccounts");
const subs = await tryQuery("SELECT * FROM subscriptions");
const reviews = await tryQuery("SELECT * FROM reviewaccounts");
const logs = await tryQuery("SELECT * FROM logs ORDER BY datetime DESC LIMIT 20000");
await conn.end();

const stats = { users: 0, accounts: 0, subs: 0, submissions: 0, logs: 0, skipped: [] as string[] };
const now = Date.now();

tx(() => {
  const taken = new Set(q.all<{ username: string }>("SELECT username FROM users").map((r) => r.username.toLowerCase()));
  for (const u of users) {
    const id = Number(col(u, "id"));
    if (q.get("SELECT 1 FROM users WHERE id = ?", [id])) continue;
    let username = String(col(u, "username") ?? `user${id}`).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 20) || `user${id}`;
    if (username.length < 3) username = `user${id}`;
    while (taken.has(username.toLowerCase())) username = `${username.slice(0, 18)}_${id}`;
    taken.add(username.toLowerCase());
    let prefs: Record<string, unknown> = {};
    try {
      const ws = JSON.parse(String(col(u, "websiteSettings") ?? "{}"));
      prefs = { wallpaper: ws.wallpaper && ws.wallpaper !== "/images/background.png" ? ws.wallpaper : undefined, compact: Boolean(ws.zoomedOut) };
    } catch {}
    const champs = jsonArr(col(u, "gameMainChampions")).map((n) => championByName(String(n))?.key).filter(Boolean);
    q.run(
      `INSERT INTO users(id, username, discord_id, avatar_url, role, trust_rate, bio, main_roles, main_champions, prefs, register_ip, last_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, username, col(u, "discordId") ? String(col(u, "discordId")) : null, col(u, "ProfilePicture"),
        ROLE_MAP[Number(col(u, "accountType"))] ?? "customer",
        Math.max(0, Math.min(100, Number(col(u, "trustRate") ?? 50))),
        String(col(u, "Bio", "bio") ?? "").slice(0, 300),
        JSON.stringify(jsonArr(col(u, "gameMainRoles")).filter((r) => typeof r === "string")),
        JSON.stringify(champs), JSON.stringify(prefs),
        col(u, "registerIP"), col(u, "lastIP"), ms(col(u, "registerDate")),
      ],
    );
    stats.users++;
  }

  const userExists = (id: unknown) => id !== null && Boolean(q.get("SELECT 1 FROM users WHERE id = ?", [Number(id)]));

  for (const a of accounts) {
    const id = Number(col(a, "id"));
    if (q.get("SELECT 1 FROM accounts WHERE id = ?", [id])) continue;
    const server = normalizeServer(col(a, "server"));
    const riotId = String(col(a, "RiotID") ?? "").trim();
    const login = col(a, "accusr");
    const password = col(a, "accpwd");
    if (!server || !riotId || !login || !password) {
      stats.skipped.push(`account #${id} (missing server/riot id/credentials)`);
      continue;
    }
    if (q.get("SELECT 1 FROM accounts WHERE server = ? AND riot_id = ? COLLATE NOCASE", [server, riotId])) {
      stats.skipped.push(`account #${id} (duplicate ${riotId} on ${server})`);
      continue;
    }
    const type = Number(col(a, "accountType"));
    const solo = parseLegacyRank(col(a, "SoloQueueRank"));
    const flex = parseLegacyRank(col(a, "FlexQueueRank"));
    const champions = jsonArr(col(a, "champions")).map((n) => championByName(String(n))?.key).filter((k): k is number => Boolean(k));
    const restrictions = jsonArr(col(a, "restrictions")) as { type?: string }[];
    const ban = restrictions.find((r) => r?.type === "PERMANENT_BAN" || r?.type === "TIME_BAN");
    const refresh = col(a, "refreshToken");
    const owner = col(a, "accountOwnerId");
    q.run(
      `INSERT INTO accounts(id, pool, owner_id, riot_id, server, puuid, login_enc, password_enc, trust_required,
         level, profile_icon,
         solo_tier, solo_division, solo_lp, solo_wins, solo_losses, solo_score,
         flex_tier, flex_division, flex_lp, flex_wins, flex_losses, flex_score,
         be, rp, refunds, champions, champion_count, flash_on_f, banned, ban_info, refresh_token_enc, token_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, type === 2 ? "community" : "booster", userExists(owner) ? Number(owner) : null, riotId, server, col(a, "encryptedPuuid"),
        encrypt(String(login)), encrypt(String(password)),
        type === 3 ? Math.max(80, Number(col(a, "trustRateReq") ?? 0)) : Number(col(a, "trustRateReq") ?? 0),
        col(a, "level"), col(a, "profileIconId"),
        solo.tier, solo.division, solo.lp, Number(col(a, "SoloQueueVictories") ?? 0), Number(col(a, "SoloQueueLosses") ?? 0), rankScore(solo.tier, solo.division, solo.lp),
        flex.tier, flex.division, flex.lp, Number(col(a, "FlexQueueVictories") ?? 0), Number(col(a, "FlexQueueLosses") ?? 0), rankScore(flex.tier, flex.division, flex.lp),
        col(a, "be"), col(a, "rp"), col(a, "refunds"), JSON.stringify(champions), champions.length,
        col(a, "FlashPos") ? 1 : 0, ban ? 1 : 0, ban ? JSON.stringify(ban) : null,
        refresh ? encrypt(String(refresh)) : null, refresh ? "ok" : "none", now, now,
      ],
    );
    stats.accounts++;
  }

  for (const s of subs) {
    const userId = col(s, "userId");
    if (!userExists(userId)) continue;
    q.run("INSERT INTO subscriptions(user_id, starts_at, ends_at, note, created_at) VALUES (?, ?, ?, 'imported', ?)", [
      Number(userId), ms(col(s, "start")), ms(col(s, "end")), now,
    ]);
    const key = col(s, "userkey");
    // Keep the old key so existing desktop-client installs keep working.
    if (key && !q.get("SELECT 1 FROM users WHERE client_key = ?", [String(key)])) {
      q.run("UPDATE users SET client_key = ? WHERE id = ? AND client_key IS NULL", [String(key), Number(userId)]);
    }
    stats.subs++;
  }
  for (const u of q.all<{ id: number }>("SELECT DISTINCT user_id AS id FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE u.client_key IS NULL")) {
    q.run("UPDATE users SET client_key = ? WHERE id = ?", [newClientKey(), u.id]);
  }

  for (const r of reviews) {
    const userId = col(r, "userId");
    const server = normalizeServer(col(r, "server")) ?? "euw";
    if (!userExists(userId) || !col(r, "username") || !col(r, "password")) continue;
    q.run("INSERT INTO submissions(user_id, login_enc, password_enc, server, note, created_at) VALUES (?, ?, ?, ?, 'imported from old site', ?)", [
      Number(userId), encrypt(String(col(r, "username"))), encrypt(String(col(r, "password"))), server, now,
    ]);
    stats.submissions++;
  }

  const actionMap: Record<string, string> = { use_account: "account.claim", community_use: "account.claim", stop_use: "account.release", community_stop: "account.release" };
  for (const l of logs) {
    const userId = col(l, "userId");
    const accountId = col(l, "leagueAccountId");
    q.run("INSERT INTO activity(user_id, account_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)", [
      userExists(userId) ? Number(userId) : null,
      accountId && q.get("SELECT 1 FROM accounts WHERE id = ?", [Number(accountId)]) ? Number(accountId) : null,
      actionMap[String(col(l, "action"))] ?? `legacy.${col(l, "action")}`,
      JSON.stringify({ imported: true }),
      ms(col(l, "datetime")),
    ]);
    stats.logs++;
  }
});

console.log(`Imported ${stats.users} users, ${stats.accounts} accounts, ${stats.subs} subscriptions, ${stats.submissions} submissions, ${stats.logs} log entries.`);
if (stats.skipped.length) console.log("Skipped:\n - " + stats.skipped.join("\n - "));
console.log("Note: accounts currently 'in use' on the old site were imported as free.");
