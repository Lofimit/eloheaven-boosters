/**
 * Endpoints used by the EloHeaven desktop client. Paths are kept identical to
 * the old API (/community/...) so existing client builds keep working; the
 * /api/client/... aliases are preferred for new builds.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../db.js";
import { decrypt } from "../lib/crypto.js";
import { isStaff, type Role } from "../lib/league.js";

const keyBody = z.object({ userkey: z.string().trim().min(8).max(64) });
const limit = { rateLimit: { max: 30, timeWindow: "1 minute" } };

function userForKey(raw: unknown): { id: number } | null {
  const parsed = keyBody.safeParse(raw ?? {});
  if (!parsed.success) return null;
  const now = Date.now();
  const u = q.get<{ id: number; role: Role; banned: number; sub: number | null }>(
    `SELECT u.id, u.role, u.banned,
            (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.starts_at <= ? AND s.ends_at > ? LIMIT 1) AS sub
       FROM users u WHERE u.client_key = ?`,
    [now, now, parsed.data.userkey],
  );
  if (!u || u.banned || (!u.sub && !isStaff(u.role))) return null;
  return { id: u.id };
}

export default async function clientRoutes(app: FastifyInstance) {
  for (const prefix of ["/community", "/api/client"]) {
    app.post(`${prefix}/userkey`, { config: limit }, async (req) => {
      const u = userForKey(req.body);
      return u ? { valid: true, userId: u.id } : { valid: false, error: "Invalid or expired key" };
    });

    app.post(`${prefix}/currentaccountused`, { config: limit }, async (req, reply) => {
      const u = userForKey(req.body);
      if (!u) return reply.code(403).send({ error: "Invalid key" });
      const acc = q.get<{ login_enc: string; password_enc: string }>(
        "SELECT login_enc, password_enc FROM accounts WHERE in_use_by = ? ORDER BY pool = 'community' DESC, in_use_since DESC LIMIT 1",
        [u.id],
      );
      if (!acc) return reply.code(404).send({ error: "No active account" });
      reply.header("Cache-Control", "no-store");
      return { credentials: { username: decrypt(acc.login_enc), password: decrypt(acc.password_enc) } };
    });

    // hCaptcha page shown inside the desktop client's webview when Riot asks for a captcha.
    app.get(`${prefix}/captcha`, { helmet: false }, async (req, reply) => {
      const { siteKey = "", encodedCaptchaData = "" } = (req.query ?? {}) as Record<string, string>;
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(siteKey)) return reply.code(400).send("Invalid siteKey");
      // JSON-encode + escape "<" so the value can't break out of the <script> block.
      const rqdata = JSON.stringify(String(encodedCaptchaData).slice(0, 20000)).replace(/</g, "\\u003c");
      reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("Content-Security-Policy", "default-src 'self' https://*.hcaptcha.com https://hcaptcha.com; script-src 'self' 'unsafe-inline' https://*.hcaptcha.com https://hcaptcha.com; style-src 'self' 'unsafe-inline' https://*.hcaptcha.com https://hcaptcha.com; frame-src https://*.hcaptcha.com https://hcaptcha.com; img-src 'self' data: https:");
      return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Captcha</title>
<script>
  function onLoad() { hcaptcha.execute('', { rqdata: decodeURIComponent(${rqdata}) }); }
  function onSubmit(token) { window.chrome && window.chrome.webview && window.chrome.webview.postMessage(token); }
</script>
<script src="https://js.hcaptcha.com/1/api.js?onload=onLoad" async defer></script>
<style>
  body { margin:0; overflow:hidden; font-family: system-ui, sans-serif; font-weight:500; color:#fff; background:transparent; }
  .root { display:flex; flex-direction:column; height:600px; align-items:center; background:linear-gradient(160deg,#1a1430,#0d0b1a); border-radius:12px; }
  .root p { -webkit-app-region: drag; width:100%; height:40px; margin:0; }
  .root div { -webkit-app-region: no-drag; padding-top:20px; }
</style></head>
<body><div class="root"><p></p><span>Solve the captcha to complete the login</span>
<div class="h-captcha" id="captcha" data-theme="dark" data-sitekey="${siteKey}" data-callback="onSubmit"></div></div></body></html>`;
    });
  }
}
