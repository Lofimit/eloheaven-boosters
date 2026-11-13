import { z } from "zod";
import { q } from "./db.js";
import { config } from "./config.js";

/** Runtime settings editable from the admin panel. Stored as JSON in the settings table. */
export const settingsSchema = z.object({
  siteName: z.string().min(1).max(40),
  announcement: z.string().max(1000),
  discordInvite: z.string().max(200),
  allowPasswordRegistration: z.boolean(),
  /** Hours a claimed account stays reserved before it auto-releases (unless in game). */
  leaseHours: z.number().int().min(1).max(48),
  /** Hard cap: an account held this long is always released, even mid-game or after extending. */
  maxHoldHours: z.number().int().min(1).max(72),
  /** Max accounts a single user can hold at once. */
  maxActivePerUser: z.number().int().min(1).max(10),
  /** Minutes between full rank refreshes of every account. */
  rankRefreshMinutes: z.number().int().min(15).max(1440),
  /** Try deprecated client refresh tokens for BE/RP/champions. Most tokens are dead now. */
  legacyTokenSync: z.boolean(),
  defaultTrustRate: z.number().int().min(0).max(100),
  riotApiKey: z.string().max(100),
});

export type Settings = z.infer<typeof settingsSchema>;

const defaults: Settings = {
  siteName: "EloHeaven",
  announcement: "",
  discordInvite: "https://discord.gg/kingsz",
  allowPasswordRegistration: true,
  leaseHours: 3,
  maxHoldHours: 8,
  maxActivePerUser: 1,
  rankRefreshMinutes: 60,
  legacyTokenSync: true,
  defaultTrustRate: 50,
  riotApiKey: "",
};

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  const rows = q.all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const merged: Record<string, unknown> = { ...defaults };
  for (const r of rows) {
    if (!(r.key in defaults)) continue;
    try {
      merged[r.key] = JSON.parse(r.value);
    } catch {}
  }
  const parsed = settingsSchema.safeParse(merged);
  cached = parsed.success ? parsed.data : defaults;
  return cached;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch });
  for (const [k, v] of Object.entries(patch)) {
    q.run("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, JSON.stringify(v)]);
  }
  cached = next;
  return next;
}

export const riotApiKey = () => getSettings().riotApiKey || config.riotApiKey;

/** Internal key/value state that isn't user-editable (e.g. job status, ddragon cache). */
export const state = {
  get<T>(key: string): T | null {
    const r = q.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [`_${key}`]);
    if (!r) return null;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    q.run("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`_${key}`, JSON.stringify(value)]);
  },
};
