import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reads an env var, ignoring surrounding whitespace and quotes (common when pasting into a hosting panel). */
function str(name: string, fallback = ""): string {
  const v = (process.env[name] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

const isProd = process.env.NODE_ENV === "production";
const publicUrl = str("PUBLIC_URL", "http://localhost:5173").replace(/\/+$/, "");

export const config = {
  isProd,
  port: int("PORT", 3000),
  host: str("HOST", "0.0.0.0"),
  /** Public origin users load the site from, e.g. https://eloheaven.pw */
  publicUrl,
  /** Extra origins allowed to send cookie-authenticated mutations (comma separated). */
  extraOrigins: str("EXTRA_ORIGINS")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  dataDir: path.resolve(str("DATA_DIR", path.join(here, "..", "data"))),
  webDist: path.resolve(str("WEB_DIST", path.join(here, "..", "..", "web", "dist"))),
  /** Master secret: derives the credential-encryption key. Never change it once accounts exist. */
  appSecret: str("APP_SECRET"),
  discord: {
    clientId: str("DISCORD_CLIENT_ID"),
    clientSecret: str("DISCORD_CLIENT_SECRET"),
    redirectUri: str("DISCORD_REDIRECT_URI", `${publicUrl}/api/auth/discord/callback`),
    /** Optional: lets the server keep avatars fresh without the user logging in again. */
    botToken: str("DISCORD_BOT_TOKEN"),
  },
  /** Discord user IDs that are always promoted to owner on login. */
  ownerDiscordIds: str("OWNER_DISCORD_IDS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Fallback Riot API key; can be overridden from the admin panel. */
  riotApiKey: str("RIOT_API_KEY"),
  /** Minimum spacing between Riot API calls. 1250ms keeps a dev key under 100 req / 2 min. */
  riotMinIntervalMs: int("RIOT_MIN_INTERVAL_MS", 1250),
  sessionDays: int("SESSION_DAYS", 30),
  trustProxy: str("TRUST_PROXY", "true") !== "false",
} as const;

export function assertConfig() {
  const problems: string[] = [];
  if (config.appSecret.length < 32) problems.push("APP_SECRET must be set to at least 32 characters");
  if (problems.length) {
    if (config.isProd) throw new Error("Invalid configuration:\n - " + problems.join("\n - "));
    console.warn("[config] " + problems.join("; ") + " (using an insecure dev default)");
  }
}

export const discordEnabled = () => Boolean(config.discord.clientId && config.discord.clientSecret);
