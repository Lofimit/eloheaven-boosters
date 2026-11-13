import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, dbFile, q, tx } from "../db.js";
import { requireRole, type SessionUser } from "../auth.js";
import { ACCOUNT_COLUMNS, ACCOUNT_JOINS, releaseAccount, serializeAccount, type AccountRow } from "../lib/accounts.js";
import { logActivity } from "../lib/activity.js";
import { decrypt, encrypt, newClientKey } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, jsonObject, notFound, parse } from "../lib/http.js";
import { normalizeServer, POOLS, ROLES, roleRank, SERVER_CODES, type Role } from "../lib/league.js";
import { getUser, selfUser, USERNAME_RE, type UserRow } from "../lib/users.js";
import { keyStatus } from "../riot/api.js";
import { refreshAll, refreshStatus, syncAccount } from "../riot/sync.js";
import { getSettings, settingsSchema, updateSettings } from "../settings.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const riotIdSchema = z.string().trim().regex(/^.{1,24}#.{2,6}$/, "Riot ID must look like Name#TAG");
const serverSchema = z.string().transform((s, ctx) => {
  const n = normalizeServer(s);
  if (!n) ctx.addIssue({ code: "custom", message: "Unknown server" });
  return n!;
});
const page = z.coerce.number().int().min(1).default(1);

const accountBody = z.object({
  pool: z.enum(POOLS),
  riotId: riotIdSchema,
  server: serverSchema,
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
  trustRequired: z.number().int().min(0).max(100).default(0),
  notes: z.string().max(1000).default(""),
  active: z.boolean().default(true),
  ownerId: z.number().int().positive().nullable().optional(),
  be: z.number().int().min(0).nullable().optional(),
  rp: z.number().int().min(0).nullable().optional(),
  refunds: z.number().int().min(0).max(10).nullable().optional(),
  champions: z.array(z.number().int().positive()).max(400).optional(),
  flashOnF: z.boolean().default(false),
  banned: z.boolean().default(false),
  /** Legacy client refresh token. Empty string clears it. */
  refreshToken: z.string().max(4000).optional(),
});

function uniqueGuard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw conflict("An account with that Riot ID already exists on this server");
    throw err;
  }
}

/** Actors may only manage users strictly below them (owners can manage anyone but themselves' role). */
function assertCanManage(actor: SessionUser, target: UserRow) {
  if (actor.role === "owner") return;
  if (roleRank(target.role) >= roleRank(actor.role)) throw forbidden("You can't manage a user with an equal or higher role");
}

function maskKey(k: string) {
  return k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "";
}

export default async function adminRoutes(app: FastifyInstance) {
  const staff = (req: FastifyRequest) => requireRole(req, "moderator");
  const admin = (req: FastifyRequest) => requireRole(req, "admin");

  /* --------------------------------- overview -------------------------------- */

  app.get("/api/admin/overview", async (req) => {
    staff(req);
    const now = Date.now();
    const accounts = q.get(
      `SELECT COUNT(*) AS total, SUM(active) AS active, SUM(in_use_by IS NOT NULL) AS inUse, SUM(banned) AS banned,
              SUM(sync_error IS NOT NULL) AS syncErrors, SUM(in_game) AS inGame,
              SUM(pool = 'booster') AS booster, SUM(pool = 'community') AS community
         FROM accounts`,
    );
    const users = q.get(
      `SELECT COUNT(*) AS total, SUM(last_seen_at > ?) AS active7d, SUM(created_at > ?) AS new7d, SUM(banned) AS banned FROM users`,
      [now - 7 * 86400_000, now - 7 * 86400_000],
    );
    const subs = q.get<{ n: number }>("SELECT COUNT(DISTINCT user_id) AS n FROM subscriptions WHERE starts_at <= ? AND ends_at > ?", [now, now]);
    const pending = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending'");
    const claimsPerDay = q.all(
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS claims
         FROM activity WHERE action = 'account.claim' AND created_at > ? GROUP BY day ORDER BY day`,
      [now - 14 * 86400_000],
    );
    const inUse = q.all<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a ${ACCOUNT_JOINS} WHERE a.in_use_by IS NOT NULL ORDER BY a.in_use_since`);
    let dbBytes = 0;
    try {
      dbBytes = fs.statSync(dbFile).size + (fs.existsSync(dbFile + "-wal") ? fs.statSync(dbFile + "-wal").size : 0);
    } catch {}
    const viewer = staff(req);
    return {
      accounts, users, activeSubscriptions: subs?.n ?? 0, pendingSubmissions: pending?.n ?? 0, claimsPerDay,
      inUse: inUse.map((a) => serializeAccount(a, viewer)),
      system: { refresh: refreshStatus(), riotKey: keyStatus(), dbBytes, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) },
    };
  });

  /* --------------------------------- accounts -------------------------------- */

  app.get("/api/admin/accounts", async (req) => {
    const viewer = staff(req);
    const f = parse(
      z.object({
        q: z.string().trim().max(40).optional(),
        pool: z.enum(POOLS).optional(),
        status: z.enum(["in_use", "available", "banned", "inactive", "error", "token_ok"]).optional(),
        server: z.enum(SERVER_CODES as [string, ...string[]]).optional(),
        page,
      }),
      req.query,
    );
    const where = ["1 = 1"];
    const params: (string | number)[] = [];
    if (f.q) where.push("(a.riot_id LIKE ? OR a.notes LIKE ? OR CAST(a.id AS TEXT) = ?)"), params.push(`%${f.q}%`, `%${f.q}%`, f.q);
    if (f.pool) where.push("a.pool = ?"), params.push(f.pool);
    if (f.server) where.push("a.server = ?"), params.push(f.server);
    const statusSql: Record<string, string> = {
      in_use: "a.in_use_by IS NOT NULL",
      available: "a.in_use_by IS NULL AND a.banned = 0 AND a.active = 1",
      banned: "a.banned = 1",
      inactive: "a.active = 0",
      error: "a.sync_error IS NOT NULL",
      token_ok: "a.token_status = 'ok'",
    };
    if (f.status) where.push(statusSql[f.status]!);
    const w = where.join(" AND ");
    const pageSize = 30;
    const total = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts a WHERE ${w}`, params)!.n;
    const rows = q.all<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts a ${ACCOUNT_JOINS} WHERE ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (f.page - 1) * pageSize],
    );
    return { items: rows.map((r) => serializeAccount(r, viewer)), total, page: f.page, pageSize };
  });

  app.get("/api/admin/accounts/:id/secrets", async (req, reply) => {
    staff(req);
    const { id } = parse(idParam, req.params);
    const row = q.get<{ login_enc: string; password_enc: string; refresh_token_enc: string | null; champions: string; owner_id: number | null }>(
      "SELECT login_enc, password_enc, refresh_token_enc, champions, owner_id FROM accounts WHERE id = ?",
      [id],
    );
    if (!row) throw notFound();
    reply.header("Cache-Control", "no-store");
    logActivity(req, "admin.account_secrets", { accountId: id });
    return {
      login: decrypt(row.login_enc),
      password: decrypt(row.password_enc),
      refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : "",
      champions: JSON.parse(row.champions),
      ownerId: row.owner_id,
    };
  });

  app.post("/api/admin/accounts", async (req) => {
    staff(req);
    const b = parse(accountBody, req.body);
    const now = Date.now();
    const id = uniqueGuard(() =>
      Number(
        q.run(
          `INSERT INTO accounts(pool, owner_id, active, riot_id, server, login_enc, password_enc, trust_required, notes,
                                be, rp, refunds, champions, champion_count, flash_on_f, banned, refresh_token_enc, token_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            b.pool, b.ownerId ?? null, b.active ? 1 : 0, b.riotId, b.server, encrypt(b.login), encrypt(b.password), b.trustRequired, b.notes,
            b.be ?? null, b.rp ?? null, b.refunds ?? null, JSON.stringify(b.champions ?? []), b.champions?.length ?? 0,
            b.flashOnF ? 1 : 0, b.banned ? 1 : 0, b.refreshToken ? encrypt(b.refreshToken) : null, b.refreshToken ? "ok" : "none", now, now,
          ],
        ).lastInsertRowid,
      ),
    );
    logActivity(req, "admin.account_created", { accountId: id });
    void syncAccount(id).catch(() => {});
    return { id };
  });

  app.patch("/api/admin/accounts/:id", async (req) => {
    staff(req);
    const { id } = parse(idParam, req.params);
    const b = parse(accountBody.partial(), req.body);
    const cur = q.get<{ riot_id: string; server: string }>("SELECT riot_id, server FROM accounts WHERE id = ?", [id]);
    if (!cur) throw notFound();

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const set = (col: string, val: string | number | null) => (sets.push(`${col} = ?`), params.push(val));
    if (b.pool) set("pool", b.pool);
    if (b.riotId !== undefined) set("riot_id", b.riotId);
    if (b.server !== undefined) set("server", b.server);
    if (b.login !== undefined) set("login_enc", encrypt(b.login));
    if (b.password !== undefined) set("password_enc", encrypt(b.password));
    if (b.trustRequired !== undefined) set("trust_required", b.trustRequired);
    if (b.notes !== undefined) set("notes", b.notes);
    if (b.active !== undefined) set("active", b.active ? 1 : 0);
    if (b.ownerId !== undefined) set("owner_id", b.ownerId);
    if (b.be !== undefined) set("be", b.be);
    if (b.rp !== undefined) set("rp", b.rp);
    if (b.refunds !== undefined) set("refunds", b.refunds);
    if (b.champions !== undefined) set("champions", JSON.stringify([...new Set(b.champions)])), set("champion_count", new Set(b.champions).size);
    if (b.flashOnF !== undefined) set("flash_on_f", b.flashOnF ? 1 : 0);
    if (b.banned !== undefined) set("banned", b.banned ? 1 : 0);
    if (b.refreshToken !== undefined) {
      set("refresh_token_enc", b.refreshToken ? encrypt(b.refreshToken) : null);
      set("token_status", b.refreshToken ? "ok" : "none");
    }
    const identityChanged =
      (b.riotId !== undefined && b.riotId.toLowerCase() !== cur.riot_id.toLowerCase()) || (b.server !== undefined && b.server !== cur.server);
    if (identityChanged) set("puuid", null), set("riotid_synced_at", null);
    if (!sets.length) return { ok: true };
    set("updated_at", Date.now());
    uniqueGuard(() => q.run(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`, [...params, id]));
    logActivity(req, "admin.account_updated", { accountId: id, details: { fields: Object.keys(b).filter((k) => k !== "password" && k !== "refreshToken") } });
    if (identityChanged || b.refreshToken) void syncAccount(id).catch(() => {});
    return { ok: true };
  });

  app.delete("/api/admin/accounts/:id", async (req) => {
    admin(req);
    const { id } = parse(idParam, req.params);
    const r = q.run("DELETE FROM accounts WHERE id = ?", [id]);
    if (Number(r.changes) === 0) throw notFound();
    logActivity(req, "admin.account_deleted", { details: { accountId: id } });
    return { ok: true };
  });

  app.post("/api/admin/accounts/:id/release", async (req) => {
    staff(req);
    const { id } = parse(idParam, req.params);
    const { userId } = releaseAccount(id);
    logActivity(req, "account.force_release", { accountId: id, details: { from: userId } });
    return { ok: true };
  });

  app.post("/api/admin/refresh-all", async (req) => {
    staff(req);
    if (refreshStatus().running) return { started: false, status: refreshStatus() };
    void refreshAll();
    logActivity(req, "admin.refresh_all");
    return { started: true, status: refreshStatus() };
  });

  /* -------------------------------- submissions ------------------------------- */

  app.get("/api/admin/submissions", async (req) => {
    staff(req);
    const f = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending"), page }), req.query);
    const pageSize = 30;
    const total = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM submissions WHERE status = ?", [f.status])!.n;
    const items = q.all(
      `SELECT s.id, s.server, s.riot_id AS riotId, s.note, s.status, s.review_note AS reviewNote, s.account_id AS accountId,
              s.created_at AS createdAt, s.reviewed_at AS reviewedAt,
              u.id AS userId, u.username, u.trust_rate AS userTrust, r.username AS reviewer
         FROM submissions s JOIN users u ON u.id = s.user_id LEFT JOIN users r ON r.id = s.reviewer_id
        WHERE s.status = ? ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [f.status, pageSize, (f.page - 1) * pageSize],
    );
    return { items, total, page: f.page, pageSize };
  });

  app.get("/api/admin/submissions/:id/secrets", async (req, reply) => {
    staff(req);
    const { id } = parse(idParam, req.params);
    const s = q.get<{ login_enc: string; password_enc: string }>("SELECT login_enc, password_enc FROM submissions WHERE id = ?", [id]);
    if (!s) throw notFound();
    reply.header("Cache-Control", "no-store");
    return { login: decrypt(s.login_enc), password: decrypt(s.password_enc) };
  });

  app.post("/api/admin/submissions/:id/approve", async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    const b = parse(
      z.object({ riotId: riotIdSchema, pool: z.enum(POOLS).default("community"), trustRequired: z.number().int().min(0).max(100).default(0) }),
      req.body,
    );
    const accountId = tx(() => {
      const s = q.get<{ user_id: number; login_enc: string; password_enc: string; server: string; status: string; note: string }>(
        "SELECT * FROM submissions WHERE id = ?",
        [id],
      );
      if (!s) throw notFound();
      if (s.status !== "pending") throw conflict("Already reviewed");
      const now = Date.now();
      const newId = uniqueGuard(() =>
        Number(
          q.run(
            `INSERT INTO accounts(pool, owner_id, riot_id, server, login_enc, password_enc, trust_required, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [b.pool, s.user_id, b.riotId, s.server, s.login_enc, s.password_enc, b.trustRequired, s.note ? `Lender note: ${s.note}` : "", now, now],
          ).lastInsertRowid,
        ),
      );
      q.run("UPDATE submissions SET status = 'approved', reviewer_id = ?, reviewed_at = ?, account_id = ? WHERE id = ?", [actor.id, now, newId, id]);
      return newId;
    });
    logActivity(req, "admin.submission_approved", { accountId, details: { submissionId: id } });
    void syncAccount(accountId).catch(() => {});
    return { ok: true, accountId };
  });

  app.post("/api/admin/submissions/:id/reject", async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ note: z.string().trim().max(300).default("") }), req.body);
    const r = q.run(
      "UPDATE submissions SET status = 'rejected', reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
      [actor.id, b.note || null, Date.now(), id],
    );
    if (Number(r.changes) === 0) throw conflict("Already reviewed or not found");
    logActivity(req, "admin.submission_rejected", { details: { submissionId: id } });
    return { ok: true };
  });

  /* ----------------------------------- users ---------------------------------- */

  app.get("/api/admin/users", async (req) => {
    staff(req);
    const f = parse(z.object({ q: z.string().trim().max(40).optional(), role: z.enum(ROLES).optional(), subscribed: z.enum(["1"]).optional(), banned: z.enum(["1"]).optional(), page }), req.query);
    const where = ["1 = 1"];
    const params: (string | number)[] = [];
    const now = Date.now();
    if (f.q) where.push("(u.username LIKE ? OR u.discord_id = ? OR CAST(u.id AS TEXT) = ?)"), params.push(`%${f.q}%`, f.q, f.q);
    if (f.role) where.push("u.role = ?"), params.push(f.role);
    if (f.banned) where.push("u.banned = 1");
    if (f.subscribed) where.push("EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.starts_at <= ? AND s.ends_at > ?)"), params.push(now, now);
    const w = where.join(" AND ");
    const pageSize = 30;
    const total = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users u WHERE ${w}`, params)!.n;
    const items = q.all(
      `SELECT u.id, u.username, u.avatar_url AS avatarUrl, u.role, u.trust_rate AS trustRate, u.banned, u.discord_id IS NOT NULL AS discord,
              u.created_at AS createdAt, u.last_seen_at AS lastSeenAt, u.last_ip AS lastIp,
              (SELECT MAX(ends_at) FROM subscriptions s WHERE s.user_id = u.id AND s.ends_at > ${now}) AS subscriptionEndsAt
         FROM users u WHERE ${w} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (f.page - 1) * pageSize],
    );
    return { items, total, page: f.page, pageSize };
  });

  app.get("/api/admin/users/:id", async (req) => {
    staff(req);
    const { id } = parse(idParam, req.params);
    const u = getUser(id);
    if (!u) throw notFound();
    return {
      user: { ...selfUser(u), discordId: u.discord_id, banReason: u.ban_reason, registerIp: u.register_ip, lastIp: u.last_ip },
      subscriptions: q.all(
        `SELECT s.id, s.starts_at AS startsAt, s.ends_at AS endsAt, s.note, c.username AS createdBy
           FROM subscriptions s LEFT JOIN users c ON c.id = s.created_by WHERE s.user_id = ? ORDER BY s.ends_at DESC`,
        [id],
      ),
      sessions: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?", [id, Date.now()])!.n,
      holding: q.all("SELECT id, riot_id AS riotId, in_use_since AS since FROM accounts WHERE in_use_by = ?", [id]),
      activity: q.all(
        `SELECT ac.id, ac.action, ac.details, ac.ip, ac.created_at AS createdAt, a.riot_id AS riotId, ac.account_id AS accountId
           FROM activity ac LEFT JOIN accounts a ON a.id = ac.account_id WHERE ac.user_id = ? ORDER BY ac.id DESC LIMIT 30`,
        [id],
      ),
    };
  });

  app.patch("/api/admin/users/:id", async (req) => {
    const actor = admin(req);
    const { id } = parse(idParam, req.params);
    const target = getUser(id);
    if (!target) throw notFound();
    const b = parse(
      z.object({
        username: z.string().trim().regex(USERNAME_RE).optional(),
        role: z.enum(ROLES).optional(),
        trustRate: z.number().int().min(0).max(100).optional(),
        banned: z.boolean().optional(),
        banReason: z.string().trim().max(200).nullable().optional(),
        bio: z.string().max(300).optional(),
      }),
      req.body,
    );
    if (target.id === actor.id && (b.role || b.banned)) throw badRequest("You can't change your own role or ban yourself");
    assertCanManage(actor, target);
    if (b.role && actor.role !== "owner" && roleRank(b.role as Role) >= roleRank(actor.role)) throw forbidden("You can only assign roles below your own");

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const set = (c: string, v: string | number | null) => (sets.push(`${c} = ?`), params.push(v));
    if (b.username !== undefined) {
      if (q.get("SELECT 1 FROM users WHERE username = ? AND id != ?", [b.username, id])) throw conflict("That username is taken");
      set("username", b.username);
    }
    if (b.role) set("role", b.role);
    if (b.trustRate !== undefined) set("trust_rate", b.trustRate);
    if (b.bio !== undefined) set("bio", b.bio);
    if (b.banned !== undefined) set("banned", b.banned ? 1 : 0);
    if (b.banReason !== undefined) set("ban_reason", b.banReason);
    if (!sets.length) return { ok: true };
    tx(() => {
      q.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
      if (b.banned) {
        q.run("DELETE FROM sessions WHERE user_id = ?", [id]);
        q.run("UPDATE accounts SET in_use_by = NULL, in_use_since = NULL, lease_expires_at = NULL WHERE in_use_by = ?", [id]);
      }
    });
    logActivity(req, "admin.user_updated", { details: { target: id, ...b } });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/subscriptions", async (req) => {
    const actor = admin(req);
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ days: z.number().int().min(1).max(3650), note: z.string().trim().max(200).default("") }), req.body);
    const u = getUser(id);
    if (!u) throw notFound();
    const now = Date.now();
    // Stack on top of any current subscription.
    const currentEnd = q.get<{ e: number | null }>("SELECT MAX(ends_at) AS e FROM subscriptions WHERE user_id = ? AND ends_at > ?", [id, now])?.e;
    const start = currentEnd ?? now;
    const end = start + b.days * 86400_000;
    tx(() => {
      q.run("INSERT INTO subscriptions(user_id, starts_at, ends_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, start, end, b.note || null, actor.id, now]);
      if (!u.client_key) q.run("UPDATE users SET client_key = ? WHERE id = ?", [newClientKey(), id]);
    });
    logActivity(req, "admin.subscription_added", { details: { target: id, days: b.days } });
    return { ok: true, endsAt: end };
  });

  app.delete("/api/admin/subscriptions/:id", async (req) => {
    admin(req);
    const { id } = parse(idParam, req.params);
    const r = q.run("DELETE FROM subscriptions WHERE id = ?", [id]);
    if (Number(r.changes) === 0) throw notFound();
    logActivity(req, "admin.subscription_removed", { details: { subscriptionId: id } });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/logout-all", async (req) => {
    const actor = admin(req);
    const { id } = parse(idParam, req.params);
    const target = getUser(id);
    if (!target) throw notFound();
    assertCanManage(actor, target);
    q.run("DELETE FROM sessions WHERE user_id = ?", [id]);
    return { ok: true };
  });

  /* --------------------------------- activity -------------------------------- */

  app.get("/api/admin/activity", async (req) => {
    staff(req);
    const f = parse(
      z.object({
        userId: z.coerce.number().int().positive().optional(),
        accountId: z.coerce.number().int().positive().optional(),
        action: z.string().trim().max(40).optional(),
        page,
      }),
      req.query,
    );
    const where = ["1 = 1"];
    const params: (string | number)[] = [];
    if (f.userId) where.push("ac.user_id = ?"), params.push(f.userId);
    if (f.accountId) where.push("ac.account_id = ?"), params.push(f.accountId);
    if (f.action) where.push("ac.action LIKE ?"), params.push(`${f.action}%`);
    const w = where.join(" AND ");
    const pageSize = 50;
    const total = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM activity ac WHERE ${w}`, params)!.n;
    const items = q
      .all<{ details: string | null }>(
        `SELECT ac.id, ac.action, ac.details, ac.ip, ac.created_at AS createdAt, ac.user_id AS userId, u.username,
                ac.account_id AS accountId, a.riot_id AS riotId
           FROM activity ac LEFT JOIN users u ON u.id = ac.user_id LEFT JOIN accounts a ON a.id = ac.account_id
          WHERE ${w} ORDER BY ac.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (f.page - 1) * pageSize],
      )
      .map((r) => ({ ...r, details: jsonObject(r.details) }));
    return { items, total, page: f.page, pageSize };
  });

  /* --------------------------------- settings -------------------------------- */

  app.get("/api/admin/settings", async (req) => {
    admin(req);
    const s = getSettings();
    return { settings: { ...s, riotApiKey: maskKey(s.riotApiKey) }, riotKeyFromEnv: !s.riotApiKey && Boolean(process.env.RIOT_API_KEY), riotKey: keyStatus() };
  });

  app.put("/api/admin/settings", async (req) => {
    admin(req);
    const patch = parse(settingsSchema.partial(), req.body);
    // The masked key is echoed back by the form; only store real changes.
    if (patch.riotApiKey !== undefined && patch.riotApiKey.includes("…")) delete patch.riotApiKey;
    const s = updateSettings(patch);
    logActivity(req, "admin.settings_updated", { details: { keys: Object.keys(patch) } });
    return { settings: { ...s, riotApiKey: maskKey(s.riotApiKey) } };
  });

  app.post("/api/admin/backup", async (req, reply) => {
    admin(req);
    // Consistent snapshot of the live DB via VACUUM INTO, streamed to the admin.
    const tmp = `${dbFile}.backup-${Date.now()}`;
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    logActivity(req, "admin.backup");
    const stream = fs.createReadStream(tmp);
    stream.on("close", () => fs.rm(tmp, () => {}));
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="eloheaven-${new Date().toISOString().slice(0, 10)}.db"`);
    return reply.send(stream);
  });
}
