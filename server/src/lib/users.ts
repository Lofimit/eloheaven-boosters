import { q } from "../db.js";
import { getSettings } from "../settings.js";
import { jsonArray, jsonObject } from "./http.js";
import type { Role } from "./league.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string | null;
  discord_id: string | null;
  avatar_url: string | null;
  role: Role;
  trust_rate: number;
  bio: string;
  main_roles: string;
  main_champions: string;
  prefs: string;
  client_key: string | null;
  banned: number;
  ban_reason: string | null;
  register_ip: string | null;
  last_ip: string | null;
  created_at: number;
  last_seen_at: number | null;
}

export interface Prefs {
  wallpaper?: string;
  compact?: boolean;
  reduceMotion?: boolean;
}

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;

export const getUser = (id: number) => q.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);

/** Public profile: safe to show to any signed-in user. */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    avatarUrl: u.avatar_url,
    role: u.role,
    trustRate: u.trust_rate,
    bio: u.bio,
    mainRoles: jsonArray<string>(u.main_roles),
    mainChampions: jsonArray<number>(u.main_champions),
    banned: Boolean(u.banned),
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
  };
}

/** What the signed-in user sees about themself. */
export function selfUser(u: UserRow) {
  return {
    ...publicUser(u),
    prefs: jsonObject<Prefs>(u.prefs),
    hasPassword: Boolean(u.password_hash),
    discordLinked: Boolean(u.discord_id),
    clientKey: u.client_key,
  };
}

/** Find a free username based on a preferred one ("neo" -> "neo", "neo_2", ...). */
export function uniqueUsername(preferred: string): string {
  let base = preferred.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 20);
  if (base.length < 3) base = `user${base}`.slice(0, 20);
  let name = base;
  for (let i = 2; q.get("SELECT 1 FROM users WHERE username = ?", [name]); i++) name = `${base}_${i}`;
  return name;
}

export function createUser(data: { username: string; passwordHash?: string | null; discordId?: string | null; avatarUrl?: string | null; role?: Role; ip?: string }) {
  const now = Date.now();
  const r = q.run(
    `INSERT INTO users(username, password_hash, discord_id, avatar_url, role, trust_rate, register_ip, last_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.username, data.passwordHash ?? null, data.discordId ?? null, data.avatarUrl ?? null,
      data.role ?? "customer", getSettings().defaultTrustRate, data.ip ?? null, data.ip ?? null, now,
    ],
  );
  return Number(r.lastInsertRowid);
}
