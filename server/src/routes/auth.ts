import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, discordEnabled } from "../config.js";
import { q } from "../db.js";
import { createSession, destroySession, hasActiveSubscription, poolAccess } from "../auth.js";
import { logActivity } from "../lib/activity.js";
import { hashPassword, randomToken, verifyPassword } from "../lib/crypto.js";
import { badRequest, conflict, HttpError, parse } from "../lib/http.js";
import { discordAvatarUrl } from "../lib/discord.js";
import { createUser, getUser, selfUser, uniqueUsername, USERNAME_RE, type UserRow } from "../lib/users.js";
import { getSettings } from "../settings.js";

const STATE_COOKIE = "eh_oauth";
const strictLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

const credentials = z.object({
  username: z.string().trim().regex(USERNAME_RE, "3-24 characters: letters, numbers, _ . -"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});


export default async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (req) => {
    if (!req.user) return { user: null };
    const u = getUser(req.user.id);
    if (!u) return { user: null };
    const sub = hasActiveSubscription(u.id);
    return {
      user: selfUser(u),
      access: u.banned ? { booster: false, community: false } : poolAccess(req.user),
      subscriptionEndsAt: sub?.ends_at ?? null,
    };
  });

  app.post("/api/auth/login", { config: strictLimit }, async (req, reply) => {
    const body = parse(z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) }), req.body);
    const u = q.get<UserRow>("SELECT * FROM users WHERE username = ?", [body.username]);
    // Always run a hash comparison to keep timing roughly constant.
    const ok = await verifyPassword(body.password, u?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA");
    if (!u || !ok) throw new HttpError(401, "Wrong username or password");
    if (u.banned) throw new HttpError(403, `Your account is banned${u.ban_reason ? `: ${u.ban_reason}` : ""}`);
    createSession(req, reply, u.id);
    logActivity(req, "auth.login", { userId: u.id, details: { method: "password" } });
    return { ok: true };
  });

  app.post("/api/auth/register", { config: strictLimit }, async (req, reply) => {
    if (!getSettings().allowPasswordRegistration) throw new HttpError(403, "Registration is currently closed. Use Discord to sign in.");
    const body = parse(credentials, req.body);
    if (q.get("SELECT 1 FROM users WHERE username = ?", [body.username])) throw conflict("That username is taken");
    const id = createUser({ username: body.username, passwordHash: await hashPassword(body.password), ip: req.ip });
    createSession(req, reply, id);
    logActivity(req, "auth.register", { userId: id, details: { method: "password" } });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  /* ------------------------------- Discord OAuth ------------------------------ */

  app.get("/api/auth/discord", { config: strictLimit }, async (req, reply) => {
    if (!discordEnabled()) throw badRequest("Discord login is not configured");
    const state = randomToken(16);
    reply.setCookie(STATE_COOKIE, state, { path: "/api/auth", httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: 600 });
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: config.discord.clientId,
      redirect_uri: config.discord.redirectUri,
      response_type: "code",
      scope: "identify",
      state,
      prompt: "none",
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get("/api/auth/discord/callback", { config: strictLimit }, async (req, reply) => {
    const fail = (msg: string) => reply.redirect(`/login?error=${encodeURIComponent(msg)}`);
    const { code, state } = (req.query ?? {}) as { code?: string; state?: string };
    const expected = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: "/api/auth" });
    if (!code || !state || state !== expected) return fail("Login expired, please try again");

    let profile: { id: string; username: string; global_name?: string | null; avatar: string | null };
    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: config.discord.redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) return fail("Discord rejected the login");
      const token = (await tokenRes.json()) as { access_token: string };
      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!meRes.ok) return fail("Could not read your Discord profile");
      profile = (await meRes.json()) as typeof profile;
    } catch {
      return fail("Discord is not responding, try again in a moment");
    }

    const avatar = discordAvatarUrl(profile.id, profile.avatar);
    const isOwner = config.ownerDiscordIds.includes(profile.id);
    const existing = q.get<UserRow>("SELECT * FROM users WHERE discord_id = ?", [profile.id]);

    // Linking Discord to an already signed-in (password) account.
    if (req.user) {
      if (existing && existing.id !== req.user.id) return reply.redirect(`/settings?error=${encodeURIComponent("That Discord account is linked to another user")}`);
      q.run("UPDATE users SET discord_id = ?, avatar_url = ? WHERE id = ?", [profile.id, avatar, req.user.id]);
      logActivity(req, "auth.discord_linked");
      return reply.redirect("/settings?linked=1");
    }

    let userId: number;
    if (existing) {
      if (existing.banned) return fail(`Your account is banned${existing.ban_reason ? `: ${existing.ban_reason}` : ""}`);
      userId = existing.id;
      q.run("UPDATE users SET avatar_url = ? WHERE id = ?", [avatar, userId]);
    } else {
      userId = createUser({ username: uniqueUsername(profile.username), discordId: profile.id, avatarUrl: avatar, ip: req.ip });
      logActivity(req, "auth.register", { userId, details: { method: "discord" } });
    }
    if (isOwner) q.run("UPDATE users SET role = 'owner' WHERE id = ?", [userId]);

    createSession(req, reply, userId);
    logActivity(req, "auth.login", { userId, details: { method: "discord" } });
    return reply.redirect("/dashboard");
  });
}
