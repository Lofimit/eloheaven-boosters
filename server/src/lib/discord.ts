/**
 * Discord avatar helpers.
 *
 * Avatar URLs contain a hash that changes whenever the user changes their picture
 * (and Discord deletes the old file), so we store the current URL and refresh it:
 *  - on every Discord login,
 *  - lazily when a browser reports the image is broken,
 *  - daily for recently active users.
 * Background refreshes need DISCORD_BOT_TOKEN (any bot of the same app works;
 * it doesn't have to join a server).
 */
import { config } from "../config.js";
import { q } from "../db.js";

export function discordAvatarUrl(id: string, avatar: string | null | undefined): string {
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "webp"}?size=128`;
}

export const avatarRefreshEnabled = () => Boolean(config.discord.botToken);

const lastTried = new Map<number, number>();
const THROTTLE = 30 * 60_000;

/** Fetch the user's current avatar from Discord and store it. Returns the (possibly unchanged) URL. */
export async function refreshAvatar(userId: number, opts: { force?: boolean } = {}): Promise<string | null> {
  const row = q.get<{ discord_id: string | null; avatar_url: string | null }>("SELECT discord_id, avatar_url FROM users WHERE id = ?", [userId]);
  if (!row?.discord_id || !avatarRefreshEnabled()) return row?.avatar_url ?? null;
  const prev = lastTried.get(userId) ?? 0;
  if (!opts.force && Date.now() - prev < THROTTLE) return row.avatar_url;
  lastTried.set(userId, Date.now());

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${row.discord_id}`, {
      headers: { Authorization: `Bot ${config.discord.botToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return row.avatar_url;
    const u = (await res.json()) as { id: string; avatar: string | null };
    const url = discordAvatarUrl(u.id, u.avatar);
    if (url !== row.avatar_url) q.run("UPDATE users SET avatar_url = ? WHERE id = ?", [url, userId]);
    return url;
  } catch {
    return row.avatar_url;
  }
}

/** Daily: refresh avatars of users active in the last 30 days, gently spaced. */
export async function refreshRecentAvatars() {
  if (!avatarRefreshEnabled()) return;
  const ids = q
    .all<{ id: number }>("SELECT id FROM users WHERE discord_id IS NOT NULL AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 500", [
      Date.now() - 30 * 86400_000,
    ])
    .map((r) => r.id);
  for (const id of ids) {
    await refreshAvatar(id, { force: true });
    await new Promise((r) => setTimeout(r, 1500)); // well under Discord's rate limits
  }
}
