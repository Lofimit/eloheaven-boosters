# EloHeaven v2

A League of Legends account-sharing community: browse shared accounts, claim one, play, release it.
Ranks sync from Riot's **official** API. Everything (site, API, admin panel) ships as **one Docker container** with an embedded SQLite database.

```
EloHeaven/
├─ server/          Fastify + TypeScript API (Node 24, built-in node:sqlite)
├─ web/             React 19 + Vite + Tailwind 4 SPA (served by the API in production)
├─ Dockerfile       multi-stage build -> single ~290 MB image, ~55 MB RAM at idle
├─ docker-compose.yml
├─ DEPLOY.md        step-by-step Coolify guide
└─ eloheaven-be/, eloheaven-fe/   the old v1 code (only needed for the data import; safe to delete after)
```

## Why this stack

| Decision | Reason |
|---|---|
| **One container, same origin** | No CORS and no cross-site cookies (v1 needed `SameSite=None` + `.eloheaven.pw` cookie domain). Vercel would add a second deploy and cross-origin auth problems while saving nothing, because the VPS is already paid for. |
| **SQLite instead of MySQL** | For a small community it's faster (in-process, no network hop), needs no DB container (saves ~400 MB RAM), and backup is one file. WAL mode handles concurrent reads fine. |
| **Built-in admin panel** | Replaces phpMyAdmin: accounts, submissions, users, roles, trust, bans, subscriptions, activity log, settings, DB backup download. |
| **Fastify + Node 24** | Small and fast; `node:sqlite` means no native modules to compile. |

## Features

- **Auth:** Discord OAuth and/or username + password (scrypt). Link or unlink Discord from Settings. Sessions are stored server-side with httpOnly, SameSite=Lax cookies and sliding expiry.
- **Roles:** owner › admin › moderator › booster › member. Staff can only manage users below them.
- **Two pools:** *Booster* (boosters + staff) and *Community* (needs an active subscription). Per-account trust requirement.
- **Claim / lease system:** atomic claims so two people can't grab the same account. Leases auto-expire after N hours (pausing while the account is in game), with a per-user limit and an extend button. A hard cap (default **8 h**, set in Admin → Settings) always releases an account held that long, even mid-game. Logins are only revealed to the current holder, and every reveal is logged.
- **Riot sync (official API, no tokens needed):** Riot ID → PUUID, level, profile icon, Solo/Flex rank + W/L, live "in game" status, daily Riot ID rename tracking. Rate-limited for dev keys, backs off on 429, stops early on a dead key, and warns in the admin panel.
- **Legacy client tokens (optional):** tried once per account for BE/RP/refunds/champions/bans. Riot deprecated this flow, so failures are marked `invalid` and never retried. BE/RP/champions can be entered by hand in the admin panel.
- **Lend an account:** members submit logins (encrypted immediately). Staff review, then approve into a pool or reject with a reason.
- **Security:** AES-256-GCM encrypted credentials at rest, strict CSP, Origin check on every mutation, rate limits, zod validation on all inputs, XSS-safe captcha page.
- **Desktop client compatibility:** `POST /community/userkey`, `POST /community/currentaccountused` and `GET /community/captcha` keep their old paths and response shapes. Old client keys are kept by the importer.
- **UI:** dark anime theme (your wallpaper, sakura→sky gradients, glass panels, drifting petals), responsive down to phones, plus user preferences for custom wallpaper, compact mode and reduced motion.

## Local development

```bash
cp .env.example .env              # set APP_SECRET at least
cd server && npm install && npm run dev     # API on :3000
cd web && npm install && npm run dev        # UI on :5173 (proxies /api to :3000)
```

Create your first admin (no Discord needed):

```bash
cd server && npm run cli -- create-owner yourname "a-strong-password"
```

Other CLI commands: `promote <user> <role>`, `set-password <user> <pw>`, `users`.

## Importing the old MySQL data

```bash
cd server
LEGACY_DATABASE_URL="mysql://USER:PASS@HOST:3306/DBNAME" npm run import-legacy
```

This keeps user and account IDs, Discord links, roles, trust, bios, ranks, BE/RP, champions (names mapped to IDs), subscriptions and client keys, pending reviews and logs. Logins are encrypted with your `APP_SECRET` during the import. See **DEPLOY.md** for running it on the server.
