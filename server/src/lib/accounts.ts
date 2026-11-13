import { q, tx } from "../db.js";
import { conflict, forbidden, jsonArray, notFound } from "./http.js";
import { isStaff, type Pool } from "./league.js";
import { getSettings } from "../settings.js";
import type { SessionUser } from "../auth.js";

export interface AccountRow {
  id: number;
  pool: Pool;
  owner_id: number | null;
  active: number;
  riot_id: string;
  server: string;
  puuid: string | null;
  login_enc: string;
  password_enc: string;
  trust_required: number;
  notes: string;
  level: number | null;
  profile_icon: number | null;
  solo_tier: string | null;
  solo_division: string | null;
  solo_lp: number;
  solo_wins: number;
  solo_losses: number;
  flex_tier: string | null;
  flex_division: string | null;
  flex_lp: number;
  flex_wins: number;
  flex_losses: number;
  solo_score: number;
  flex_score: number;
  be: number | null;
  rp: number | null;
  refunds: number | null;
  champions: string;
  champion_count: number;
  flash_on_f: number;
  banned: number;
  ban_info: string | null;
  in_game: number;
  refresh_token_enc: string | null;
  token_status: "none" | "ok" | "invalid";
  store_synced_at: number | null;
  rank_synced_at: number | null;
  sync_error: string | null;
  in_use_by: number | null;
  in_use_since: number | null;
  lease_expires_at: number | null;
  created_at: number;
  updated_at: number;
  // joined
  in_use_username?: string | null;
  owner_username?: string | null;
}

/** Columns for list/detail queries (never includes secrets). */
export const ACCOUNT_COLUMNS = `
  a.id, a.pool, a.owner_id, a.active, a.riot_id, a.server, a.trust_required, a.notes,
  a.level, a.profile_icon,
  a.solo_tier, a.solo_division, a.solo_lp, a.solo_wins, a.solo_losses, a.solo_score,
  a.flex_tier, a.flex_division, a.flex_lp, a.flex_wins, a.flex_losses, a.flex_score,
  a.be, a.rp, a.refunds, a.champion_count, a.flash_on_f, a.banned, a.ban_info, a.in_game,
  a.token_status, a.store_synced_at, a.rank_synced_at, a.sync_error, a.puuid IS NOT NULL AS has_puuid,
  a.refresh_token_enc IS NOT NULL AS has_token,
  a.in_use_by, a.in_use_since, a.lease_expires_at, a.created_at, a.updated_at,
  iu.username AS in_use_username, ow.username AS owner_username`;

export const ACCOUNT_JOINS = `LEFT JOIN users iu ON iu.id = a.in_use_by LEFT JOIN users ow ON ow.id = a.owner_id`;

export function serializeAccount(a: AccountRow & { has_puuid?: number; has_token?: number }, viewer: SessionUser, opts: { champions?: boolean } = {}) {
  const staff = isStaff(viewer.role);
  const mine = a.in_use_by === viewer.id;
  return {
    id: a.id,
    pool: a.pool,
    active: Boolean(a.active),
    riotId: a.riot_id,
    server: a.server,
    level: a.level,
    profileIcon: a.profile_icon,
    solo: { tier: a.solo_tier, division: a.solo_division, lp: a.solo_lp, wins: a.solo_wins, losses: a.solo_losses },
    flex: { tier: a.flex_tier, division: a.flex_division, lp: a.flex_lp, wins: a.flex_wins, losses: a.flex_losses },
    be: a.be,
    rp: a.rp,
    refunds: a.refunds,
    championCount: a.champion_count,
    champions: opts.champions ? jsonArray<number>(a.champions) : undefined,
    flashOnF: Boolean(a.flash_on_f),
    banned: Boolean(a.banned),
    inGame: Boolean(a.in_game),
    trustRequired: a.trust_required,
    locked: !staff && viewer.trust_rate < a.trust_required,
    inUse: a.in_use_by !== null,
    inUseByMe: mine,
    inUseBy: a.in_use_by !== null ? { id: a.in_use_by, username: a.in_use_username ?? "someone" } : null,
    inUseSince: a.in_use_since,
    leaseExpiresAt: mine || staff ? a.lease_expires_at : null,
    rankSyncedAt: a.rank_synced_at,
    storeSyncedAt: a.store_synced_at,
    tokenStatus: a.token_status,
    owner: a.owner_id ? { id: a.owner_id, username: a.owner_username ?? null } : null,
    // staff-only diagnostics
    notes: staff ? a.notes : undefined,
    syncError: staff ? a.sync_error : undefined,
    hasPuuid: staff ? Boolean(a.has_puuid) : undefined,
    hasToken: staff ? Boolean(a.has_token) : undefined,
    createdAt: a.created_at,
  };
}

export function getAccountRow(id: number) {
  return q.get<AccountRow & { has_puuid: number; has_token: number }>(
    `SELECT ${ACCOUNT_COLUMNS}, a.champions FROM accounts a ${ACCOUNT_JOINS} WHERE a.id = ?`,
    [id],
  );
}

/** Atomically reserve an account for a user. */
export function claimAccount(accountId: number, user: SessionUser) {
  const settings = getSettings();
  return tx(() => {
    const a = q.get<AccountRow>("SELECT id, pool, active, banned, trust_required, in_use_by FROM accounts WHERE id = ?", [accountId]);
    if (!a || !a.active) throw notFound("Account not found");
    if (a.in_use_by === user.id) return;
    if (a.banned) throw forbidden("This account is banned");
    if (!isStaff(user.role) && user.trust_rate < a.trust_required) {
      throw forbidden(`This account needs ${a.trust_required}% trust (you have ${user.trust_rate}%)`);
    }
    const held = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM accounts WHERE in_use_by = ?", [user.id])!.n;
    if (held >= settings.maxActivePerUser) {
      throw conflict(settings.maxActivePerUser === 1 ? "You're already using an account. Release it first." : `You can use at most ${settings.maxActivePerUser} accounts at once`);
    }
    const now = Date.now();
    const r = q.run("UPDATE accounts SET in_use_by = ?, in_use_since = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND in_use_by IS NULL", [
      user.id, now, now + Math.min(settings.leaseHours, settings.maxHoldHours) * 3600_000, now, accountId,
    ]);
    if (Number(r.changes) === 0) throw conflict("Someone just grabbed this account");
  });
}

export function releaseAccount(accountId: number): { userId: number | null; heldMs: number } {
  return tx(() => {
    const a = q.get<{ in_use_by: number | null; in_use_since: number | null }>("SELECT in_use_by, in_use_since FROM accounts WHERE id = ?", [accountId]);
    if (!a) throw notFound("Account not found");
    q.run("UPDATE accounts SET in_use_by = NULL, in_use_since = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?", [Date.now(), accountId]);
    return { userId: a.in_use_by, heldMs: a.in_use_since ? Date.now() - a.in_use_since : 0 };
  });
}
