import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../db.js";
import { assertPoolAccess, requireUser } from "../auth.js";
import {
  ACCOUNT_COLUMNS, ACCOUNT_JOINS, claimAccount, getAccountRow, releaseAccount, serializeAccount, type AccountRow,
} from "../lib/accounts.js";
import { logActivity } from "../lib/activity.js";
import { decrypt } from "../lib/crypto.js";
import { forbidden, HttpError, notFound, parse } from "../lib/http.js";
import { isStaff, POOLS, SERVER_CODES, TIERS, tierFloor } from "../lib/league.js";
import { syncAccount } from "../riot/sync.js";
import { getSettings } from "../settings.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  pool: z.enum(POOLS),
  server: z.enum(SERVER_CODES as [string, ...string[]]).optional(),
  tier: z.enum([...TIERS, "UNRANKED"] as [string, ...string[]]).optional(),
  minTier: z.enum(TIERS).optional(),
  champion: z.coerce.number().int().positive().optional(),
  minBe: z.coerce.number().int().min(0).optional(),
  available: z.enum(["1", "true"]).optional(),
  q: z.string().trim().max(40).optional(),
  sort: z.enum(["rank", "games", "level", "be", "champions", "winrate", "recent"]).default("rank"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

const SORTS: Record<string, string> = {
  rank: "a.solo_score DESC, a.flex_score DESC",
  games: "(a.solo_wins + a.solo_losses + a.flex_wins + a.flex_losses) DESC",
  level: "a.level DESC",
  be: "COALESCE(a.be, -1) DESC",
  champions: "a.champion_count DESC",
  winrate: "CASE WHEN a.solo_wins + a.solo_losses = 0 THEN -1 ELSE CAST(a.solo_wins AS REAL) / (a.solo_wins + a.solo_losses) END DESC",
  recent: "a.created_at DESC",
};

export default async function accountRoutes(app: FastifyInstance) {
  app.get("/api/accounts", async (req) => {
    const user = requireUser(req);
    const f = parse(listQuery, req.query);
    assertPoolAccess(user, f.pool);

    const where = ["a.pool = ?", "a.active = 1"];
    const params: (string | number)[] = [f.pool];
    if (f.server) where.push("a.server = ?"), params.push(f.server);
    if (f.tier === "UNRANKED") where.push("a.solo_tier IS NULL");
    else if (f.tier) where.push("(a.solo_tier = ? OR a.flex_tier = ?)"), params.push(f.tier, f.tier);
    if (f.minTier) where.push("a.solo_score >= ?"), params.push(tierFloor(f.minTier));
    if (f.champion) where.push("EXISTS (SELECT 1 FROM json_each(a.champions) WHERE value = ?)"), params.push(f.champion);
    if (f.minBe !== undefined) where.push("a.be >= ?"), params.push(f.minBe);
    if (f.available) where.push("a.in_use_by IS NULL AND a.banned = 0");
    if (f.q) where.push("a.riot_id LIKE ? ESCAPE '\\'"), params.push(`%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);

    const whereSql = where.join(" AND ");
    const total = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts a WHERE ${whereSql}`, params)!.n;
    const rows = q.all<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts a ${ACCOUNT_JOINS}
        WHERE ${whereSql}
        ORDER BY a.banned ASC, ${SORTS[f.sort]}, a.id ASC
        LIMIT ? OFFSET ?`,
      [...params, f.pageSize, (f.page - 1) * f.pageSize],
    );
    const counts = q.get<{ total: number; free: number }>(
      "SELECT COUNT(*) AS total, SUM(in_use_by IS NULL AND banned = 0) AS free FROM accounts WHERE pool = ? AND active = 1",
      [f.pool],
    )!;
    return {
      items: rows.map((r) => serializeAccount(r, user)),
      total,
      page: f.page,
      pageSize: f.pageSize,
      poolStats: { total: counts.total, available: counts.free ?? 0 },
    };
  });

  /** Accounts the current user is holding right now. */
  app.get("/api/accounts/mine", async (req) => {
    const user = requireUser(req);
    const rows = q.all<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a ${ACCOUNT_JOINS} WHERE a.in_use_by = ?`, [user.id]);
    return { items: rows.map((r) => serializeAccount(r, user)) };
  });

  app.get("/api/accounts/:id", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const row = getAccountRow(id);
    if (!row || (!row.active && !isStaff(user.role))) throw notFound("Account not found");
    assertPoolAccess(user, row.pool);
    const history = isStaff(user.role)
      ? q.all(
          `SELECT ac.id, ac.action, ac.created_at AS createdAt, ac.details, u.id AS userId, u.username
             FROM activity ac LEFT JOIN users u ON u.id = ac.user_id
            WHERE ac.account_id = ? ORDER BY ac.id DESC LIMIT 15`,
          [id],
        )
      : undefined;
    return { account: serializeAccount(row, user, { champions: true }), history };
  });

  app.post("/api/accounts/:id/claim", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const row = getAccountRow(id);
    if (!row) throw notFound("Account not found");
    assertPoolAccess(user, row.pool);
    claimAccount(id, user);
    logActivity(req, "account.claim", { accountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/release", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const row = q.get<{ in_use_by: number | null }>("SELECT in_use_by FROM accounts WHERE id = ?", [id]);
    if (!row) throw notFound("Account not found");
    if (row.in_use_by !== user.id) throw forbidden("You're not using this account");
    const { heldMs } = releaseAccount(id);
    logActivity(req, "account.release", { accountId: id, details: { minutes: Math.round(heldMs / 60000) } });
    return { ok: true };
  });

  app.post("/api/accounts/:id/extend", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const s = getSettings();
    const row = q.get<{ in_use_since: number }>("SELECT in_use_since FROM accounts WHERE id = ? AND in_use_by = ?", [id, user.id]);
    if (!row) throw forbidden("You're not using this account");
    // Extending can never go past the hard cap counted from when the account was claimed.
    const expires = Math.min(Date.now() + s.leaseHours * 3600_000, row.in_use_since + s.maxHoldHours * 3600_000);
    q.run("UPDATE accounts SET lease_expires_at = ? WHERE id = ? AND in_use_by = ?", [expires, id, user.id]);
    return { ok: true, leaseExpiresAt: expires };
  });

  app.get("/api/accounts/:id/credentials", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const row = q.get<{ login_enc: string; password_enc: string; in_use_by: number | null }>(
      "SELECT login_enc, password_enc, in_use_by FROM accounts WHERE id = ?",
      [id],
    );
    if (!row) throw notFound("Account not found");
    if (row.in_use_by !== user.id) throw forbidden("Claim this account first to see its login");
    reply.header("Cache-Control", "no-store");
    logActivity(req, "account.credentials", { accountId: id });
    return { login: decrypt(row.login_enc), password: decrypt(row.password_enc) };
  });

  app.post("/api/accounts/:id/refresh", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const row = q.get<{ in_use_by: number | null; rank_synced_at: number | null }>("SELECT in_use_by, rank_synced_at FROM accounts WHERE id = ?", [id]);
    if (!row) throw notFound("Account not found");
    if (row.in_use_by !== user.id && !isStaff(user.role)) throw forbidden("Only the current user or staff can refresh this account");
    if (!isStaff(user.role) && row.rank_synced_at && Date.now() - row.rank_synced_at < 2 * 60_000) {
      throw new HttpError(429, "This account was refreshed less than 2 minutes ago");
    }
    try {
      return await syncAccount(id);
    } catch (err) {
      throw new HttpError(503, (err as Error).message);
    }
  });
}
