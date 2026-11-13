import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { discordEnabled } from "../config.js";
import { q } from "../db.js";
import { requireUser } from "../auth.js";
import { notFound, parse } from "../lib/http.js";
import { ROLES, SERVERS } from "../lib/league.js";
import { getUser, publicUser, type UserRow } from "../lib/users.js";
import { getDDragon } from "../riot/ddragon.js";
import { getSettings } from "../settings.js";

export default async function publicRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true }));

  /** Everything the SPA needs to boot. Public. */
  app.get("/api/meta", async () => {
    const s = getSettings();
    const dd = await getDDragon();
    return {
      siteName: s.siteName,
      discordInvite: s.discordInvite,
      discordLogin: discordEnabled(),
      passwordRegistration: s.allowPasswordRegistration,
      ddragonVersion: dd?.version ?? null,
      servers: Object.entries(SERVERS).map(([code, v]) => ({ code, label: v.label, graphs: v.graphs })),
    };
  });

  app.get("/api/meta/champions", async (_req, reply) => {
    const dd = await getDDragon();
    reply.header("Cache-Control", "public, max-age=3600");
    return { version: dd?.version ?? null, champions: dd?.champions ?? [] };
  });

  app.get("/api/users", async (req) => {
    requireUser(req);
    const f = parse(
      z.object({
        q: z.string().trim().max(32).optional(),
        role: z.enum(ROLES).optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const pageSize = 24;
    const where = ["1 = 1"];
    const params: (string | number)[] = [];
    if (f.q) where.push("username LIKE ? ESCAPE '\\'"), params.push(`%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    if (f.role) where.push("role = ?"), params.push(f.role);
    const w = where.join(" AND ");
    const total = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE ${w}`, params)!.n;
    const rows = q.all<UserRow>(
      `SELECT * FROM users WHERE ${w}
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 WHEN 'booster' THEN 3 ELSE 4 END, created_at ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (f.page - 1) * pageSize],
    );
    return { items: rows.map(publicUser), total, page: f.page, pageSize };
  });

  app.get("/api/users/:id", async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const u = getUser(id);
    if (!u) throw notFound("User not found");
    const stats = q.get<{ claims: number; lent: number }>(
      `SELECT (SELECT COUNT(*) FROM activity WHERE user_id = ? AND action = 'account.claim') AS claims,
              (SELECT COUNT(*) FROM accounts WHERE owner_id = ? AND active = 1) AS lent`,
      [id, id],
    )!;
    return { user: publicUser(u), stats };
  });
}
