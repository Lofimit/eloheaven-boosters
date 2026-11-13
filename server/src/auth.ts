import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { q } from "./db.js";
import { randomToken, sha256 } from "./lib/crypto.js";
import { forbidden, HttpError, unauthorized } from "./lib/http.js";
import { isStaff, roleAtLeast, type Pool, type Role } from "./lib/league.js";

export const SESSION_COOKIE = "eh_session";

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  trust_rate: number;
  banned: number;
  ban_reason: string | null;
  last_seen_at: number | null;
  session_id: string;
  expires_at: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const DAY = 86400_000;

export function createSession(req: FastifyRequest, reply: FastifyReply, userId: number) {
  const token = randomToken();
  const now = Date.now();
  const expires = now + config.sessionDays * DAY;
  q.run("INSERT INTO sessions(id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)", [
    sha256(token), userId, now, expires, req.ip, (req.headers["user-agent"] ?? "").slice(0, 200),
  ]);
  q.run("UPDATE users SET last_seen_at = ?, last_ip = ? WHERE id = ?", [now, req.ip, userId]);
  setSessionCookie(reply, token, expires);
}

function setSessionCookie(reply: FastifyReply, token: string, expires: number) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    expires: new Date(expires),
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.user) q.run("DELETE FROM sessions WHERE id = ?", [req.user.session_id]);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

const allowedOrigins = new Set([new URL(config.publicUrl).origin, ...config.extraOrigins]);

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req, reply) => {
    // CSRF: browsers always send Origin on cross-site mutations. Reject foreign ones.
    if (req.method !== "GET" && req.method !== "HEAD" && req.url.startsWith("/api/")) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin) && config.isProd) {
        throw new HttpError(403, "Cross-site request blocked");
      }
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const row = q.get<SessionUser>(
      `SELECT u.id, u.username, u.role, u.trust_rate, u.banned, u.ban_reason, u.last_seen_at,
              s.id AS session_id, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
      [sha256(token), Date.now()],
    );
    if (!row) {
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return;
    }
    req.user = row;

    const now = Date.now();
    // Sliding expiry: renew when less than half the lifetime is left.
    if (row.expires_at - now < (config.sessionDays * DAY) / 2) {
      const expires = now + config.sessionDays * DAY;
      q.run("UPDATE sessions SET expires_at = ? WHERE id = ?", [expires, row.session_id]);
      setSessionCookie(reply, token, expires);
    }
    if (!row.last_seen_at || now - row.last_seen_at > 5 * 60_000) {
      q.run("UPDATE users SET last_seen_at = ?, last_ip = ? WHERE id = ?", [now, req.ip, row.id]);
    }
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  if (req.user.banned) throw new HttpError(403, `Your account is banned${req.user.ban_reason ? `: ${req.user.ban_reason}` : ""}`, "banned");
  return req.user;
}

export function requireRole(req: FastifyRequest, min: Role): SessionUser {
  const u = requireUser(req);
  if (!roleAtLeast(u.role, min)) throw forbidden();
  return u;
}

export function hasActiveSubscription(userId: number): { ends_at: number } | undefined {
  return q.get<{ ends_at: number }>(
    "SELECT MAX(ends_at) AS ends_at FROM subscriptions WHERE user_id = ? AND starts_at <= ? AND ends_at > ? HAVING ends_at IS NOT NULL",
    [userId, Date.now(), Date.now()],
  );
}

/** Which pools a user can browse. Staff see everything. */
export function poolAccess(u: SessionUser): Record<Pool, boolean> {
  if (isStaff(u.role)) return { booster: true, community: true };
  return {
    booster: u.role === "booster",
    community: Boolean(hasActiveSubscription(u.id)),
  };
}

export function assertPoolAccess(u: SessionUser, pool: Pool) {
  if (!poolAccess(u)[pool]) {
    throw forbidden(pool === "community" ? "An active subscription is required for community accounts" : "Booster accounts are only available to boosters and staff");
  }
}
