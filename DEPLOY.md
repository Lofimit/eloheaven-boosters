# Deploying EloHeaven on Coolify (Ubuntu 24.04 VPS)

Total footprint: one container, ~55 MB RAM at idle, one small volume. A 1 vCPU / 1 GB VPS is plenty.

## 1. Push the code to Git

Coolify builds from a Git repository (GitHub, GitLab, Gitea or any public/private repo).

```bash
cd EloHeaven
git init && git add . && git commit -m "EloHeaven v2"
git remote add origin git@github.com:<you>/eloheaven.git
git push -u origin main
```

`.gitignore` already excludes `.env`, databases and `node_modules`. **Don't commit `eloheaven-be/.env`**: it contains your old Discord secret and DB password. Delete `eloheaven-be/` and `eloheaven-fe/` before pushing if you no longer need them, or rotate those secrets.

## 2. Create the app in Coolify

1. **Projects → + New → Resource → Public/Private Repository** and pick the repo.
2. **Build pack:** `Dockerfile` (Dockerfile location `/Dockerfile`). Alternatively choose `Docker Compose` and it will use `docker-compose.yml`.
3. **Ports exposed:** `3000`.
4. **Domains:** `https://eloheaven.pw`. If the desktop client still calls `https://api.eloheaven.pw`, add that too (comma-separated): both point at the same container and the old `/community/...` endpoints work on either.
5. **Persistent storage** (Dockerfile build pack only; Compose already declares it): add a volume with
   - Name: `eloheaven-data`
   - Destination path: `/data`

   ⚠️ Without this volume the database is wiped on every deploy.
6. **Health check:** path `/api/health`, port `3000` (the image also has its own `HEALTHCHECK`).

## 3. Environment variables

In the app's **Environment Variables** tab:

| Variable | Required | Value |
|---|---|---|
| `PUBLIC_URL` | ✅ | `https://eloheaven.pw` |
| `APP_SECRET` | ✅ | output of `openssl rand -hex 32`. **Store it in your password manager.** It encrypts all account logins, and if you lose or change it they can't be decrypted. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | for Discord login | from the Discord developer portal |
| `DISCORD_BOT_TOKEN` | recommended | Discord developer portal → same app → **Bot** → Reset Token. Keeps profile pictures fresh when people change them (the bot never joins a server). Without it, avatars only update on each Discord login. |
| `OWNER_DISCORD_IDS` | optional | your Discord user ID, which makes you owner on login |
| `RIOT_API_KEY` | optional | can also be set in Admin → Settings |
| `EXTRA_ORIGINS` | optional | e.g. `https://www.eloheaven.pw` if you serve that too |

In the Discord developer portal → your app → **OAuth2 → Redirects**, add:
`https://eloheaven.pw/api/auth/discord/callback`

Then click **Deploy**. Coolify's proxy (Traefik/Caddy) handles HTTPS automatically.

## 4. First login

- **With Discord:** if your ID is in `OWNER_DISCORD_IDS`, log in and you're the owner.
- **Without Discord:** open the app's **Terminal** tab in Coolify and run
  `node dist/cli.js create-owner yourname "a-strong-password"`

Then in **Admin → Settings**, paste your Riot API key and set the announcement, Discord invite, lease length and so on.

> **Riot API key:** development keys expire every 24 h. Apply for a free **Personal API key** at developer.riotgames.com (it doesn't expire) so rank sync keeps working unattended. The admin overview shows a warning when the key is rejected.

## 5. Import the old database (once)

From the app's **Terminal** in Coolify (the container must be able to reach your old MySQL host):

```bash
LEGACY_DATABASE_URL="mysql://USER:PASSWORD@OLD_HOST:3306/DB_NAME" node dist/scripts/import-legacy.js
```

It refuses to run if users already exist, so run it **before** anyone signs up (add `--force` to merge anyway). It prints what it imported and anything it skipped, such as duplicate Riot IDs or accounts missing credentials. Accounts that were "in use" on the old site come in as free. After import, Admin → Overview → **Refresh all now** pulls fresh ranks.

If the old MySQL is only reachable from your PC, run the import locally instead (`cd server && npm run import-legacy` with the same `APP_SECRET` in `.env`), then upload `server/data/eloheaven.db` into the `/data` volume while the app is stopped.

## 6. Backups

- **Admin → Settings → Download backup** gives a consistent snapshot (`VACUUM INTO`) at any time.
- Or schedule it on the VPS, e.g. a daily cron:
  ```bash
  docker run --rm -v eloheaven-data:/data -v /root/backups:/b alpine \
    sh -c 'cp /data/eloheaven.db /b/eloheaven-$(date +%F).db'
  ```
  (Coolify prefixes volume names. Check the real name with `docker volume ls`.)

Credentials inside backups stay encrypted; restoring needs the same `APP_SECRET`.

## Cost notes

- Everything runs on the VPS you already pay for, so there's no extra service.
- Static assets are content-hashed and served with 1-year immutable caching. Put Cloudflare (free) in front if you want a CDN; set its SSL mode to *Full (strict)*.
- Riot sync uses about 4 API calls per account per hour by default (adjustable in Settings).
