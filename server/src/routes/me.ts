import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../db.js";
import { hasActiveSubscription, poolAccess, requireUser } from "../auth.js";
import { logActivity } from "../lib/activity.js";
import { encrypt, hashPassword, newClientKey, verifyPassword } from "../lib/crypto.js";
import { badRequest, conflict, HttpError, parse } from "../lib/http.js";
import { GAME_ROLES, normalizeServer } from "../lib/league.js";
import { getUser, selfUser, USERNAME_RE } from "../lib/users.js";
import { getSettings } from "../settings.js";

const httpsImage = z
  .string()
  .trim()
  .max(500)
  .refine((s) => s === "" || /^https:\/\/[^\s"'()<>]+$/i.test(s) || /^\/images\/[\w./-]+$/.test(s), "Must be an https:// image URL");

const profilePatch = z.object({
  username: z.string().trim().regex(USERNAME_RE, "3-24 characters: letters, numbers, _ . -").optional(),
  bio: z.string().max(300).optional(),
  mainRoles: z.array(z.enum(GAME_ROLES)).max(5).optional(),
  mainChampions: z.array(z.number().int().positive()).max(3).optional(),
  prefs: z
    .object({
      wallpaper: httpsImage.optional(),
      compact: z.boolean().optional(),
      reduceMotion: z.boolean().optional(),
    })
    .optional(),
});

export default async function meRoutes(app: FastifyInstance) {
  app.patch("/api/me", async (req) => {
    const user = requireUser(req);
    const body = parse(profilePatch, req.body);
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (body.username !== undefined) {
      const taken = q.get("SELECT 1 FROM users WHERE username = ? AND id != ?", [body.username, user.id]);
      if (taken) throw conflict("That username is taken");
      sets.push("username = ?"), params.push(body.username);
    }
    if (body.bio !== undefined) sets.push("bio = ?"), params.push(body.bio.trim());
    if (body.mainRoles) sets.push("main_roles = ?"), params.push(JSON.stringify([...new Set(body.mainRoles)]));
    if (body.mainChampions) sets.push("main_champions = ?"), params.push(JSON.stringify([...new Set(body.mainChampions)]));
    if (body.prefs) sets.push("prefs = ?"), params.push(JSON.stringify(body.prefs));
    if (sets.length) q.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...params, user.id]);
    return { user: selfUser(getUser(user.id)!) };
  });

  app.post("/api/me/password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ current: z.string().max(200).optional(), next: z.string().min(8, "Password must be at least 8 characters").max(200) }), req.body);
    const row = getUser(user.id)!;
    if (row.password_hash && !(await verifyPassword(body.current ?? "", row.password_hash))) throw new HttpError(400, "Current password is wrong");
    q.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(body.next), user.id]);
    // Sign out every other session.
    q.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", [user.id, user.session_id]);
    logActivity(req, "auth.password_changed");
    return { ok: true };
  });

  app.post("/api/me/unlink-discord", async (req) => {
    const user = requireUser(req);
    const row = getUser(user.id)!;
    if (!row.password_hash) throw badRequest("Set a password first, or you'd be locked out");
    q.run("UPDATE users SET discord_id = NULL WHERE id = ?", [user.id]);
    return { ok: true };
  });

  app.post("/api/me/client-key", async (req) => {
    const user = requireUser(req);
    if (!hasActiveSubscription(user.id)) throw new HttpError(403, "You need an active subscription to use the desktop client");
    const key = newClientKey();
    q.run("UPDATE users SET client_key = ? WHERE id = ?", [key, user.id]);
    logActivity(req, "client.key_regenerated");
    return { clientKey: key };
  });

  app.get("/api/me/dashboard", async (req) => {
    const user = requireUser(req);
    const access = poolAccess(user);
    const pools = q.all<{ pool: string; total: number; free: number; in_game: number }>(
      `SELECT pool, COUNT(*) AS total, SUM(in_use_by IS NULL AND banned = 0) AS free, SUM(in_game) AS in_game
         FROM accounts WHERE active = 1 GROUP BY pool`,
    );
    const recent = q.all(
      `SELECT ac.id, ac.action, ac.created_at AS createdAt, a.id AS accountId, a.riot_id AS riotId
         FROM activity ac LEFT JOIN accounts a ON a.id = ac.account_id
        WHERE ac.user_id = ? AND ac.action IN ('account.claim','account.release','account.auto_release','account.force_release')
        ORDER BY ac.id DESC LIMIT 8`,
      [user.id],
    );
    const submissions = q.get<{ pending: number; approved: number }>(
      "SELECT SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved FROM submissions WHERE user_id = ?",
      [user.id],
    );
    return {
      access,
      subscriptionEndsAt: hasActiveSubscription(user.id)?.ends_at ?? null,
      pools: Object.fromEntries(pools.filter((p) => access[p.pool as "booster" | "community"]).map((p) => [p.pool, { total: p.total, available: p.free ?? 0, inGame: p.in_game ?? 0 }])),
      recent,
      submissions: { pending: submissions?.pending ?? 0, approved: submissions?.approved ?? 0 },
      announcement: getSettings().announcement,
      leaseHours: getSettings().leaseHours,
    };
  });

  /* ------------------------------ lend an account ----------------------------- */

  app.get("/api/submissions/mine", async (req) => {
    const user = requireUser(req);
    return {
      items: q.all(
        `SELECT id, server, riot_id AS riotId, note, status, review_note AS reviewNote, account_id AS accountId,
                created_at AS createdAt, reviewed_at AS reviewedAt
           FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
        [user.id],
      ),
    };
  });

  app.post("/api/submissions", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        login: z.string().trim().min(3).max(64),
        password: z.string().min(1).max(128),
        server: z.string(),
        riotId: z.string().trim().max(40).regex(/^.{1,24}#.{2,6}$/, "Riot ID must look like Name#TAG").optional().or(z.literal("")),
        note: z.string().trim().max(300).default(""),
      }),
      req.body,
    );
    const server = normalizeServer(body.server);
    if (!server) throw badRequest("Unknown server");
    const pending = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND status = 'pending'", [user.id])!.n;
    if (pending >= 5) throw conflict("You already have 5 accounts waiting for review");
    const r = q.run(
      "INSERT INTO submissions(user_id, login_enc, password_enc, server, riot_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user.id, encrypt(body.login), encrypt(body.password), server, body.riotId || null, body.note, Date.now()],
    );
    logActivity(req, "submission.created", { details: { submissionId: Number(r.lastInsertRowid) } });
    return { ok: true };
  });

}
