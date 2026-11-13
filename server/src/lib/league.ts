/** Servers, routing and rank math shared by the API, jobs and importer. */

export const SERVERS = {
  euw: { label: "EUW", platform: "euw1", region: "europe", graphs: "euw" },
  eune: { label: "EUNE", platform: "eun1", region: "europe", graphs: "eune" },
  na: { label: "NA", platform: "na1", region: "americas", graphs: "na" },
  br: { label: "BR", platform: "br1", region: "americas", graphs: "br" },
  lan: { label: "LAN", platform: "la1", region: "americas", graphs: "lan" },
  las: { label: "LAS", platform: "la2", region: "americas", graphs: "las" },
  oce: { label: "OCE", platform: "oc1", region: "americas", graphs: "oce" },
  kr: { label: "KR", platform: "kr", region: "asia", graphs: "kr" },
  jp: { label: "JP", platform: "jp1", region: "asia", graphs: "jp" },
  tr: { label: "TR", platform: "tr1", region: "europe", graphs: "tr" },
  ru: { label: "RU", platform: "ru", region: "europe", graphs: "ru" },
  me: { label: "ME", platform: "me1", region: "europe", graphs: "me" },
  sg: { label: "SG", platform: "sg2", region: "asia", graphs: "sg" },
  tw: { label: "TW", platform: "tw2", region: "asia", graphs: "tw" },
  vn: { label: "VN", platform: "vn2", region: "asia", graphs: "vn" },
} as const;

export type ServerCode = keyof typeof SERVERS;
export const SERVER_CODES = Object.keys(SERVERS) as ServerCode[];

/** Validates a server code case-insensitively ("EUW" -> "euw"). */
export function normalizeServer(input: string | null | undefined): ServerCode | null {
  const s = (input ?? "").trim().toLowerCase();
  return s in SERVERS ? (s as ServerCode) : null;
}

export const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"] as const;
export type Tier = (typeof TIERS)[number];
const DIVISIONS: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };

/** Monotonic rank score for sorting. 0 = unranked. */
export function rankScore(tier: string | null | undefined, division: string | null | undefined, lp: number): number {
  if (!tier) return 0;
  const t = TIERS.indexOf(tier.toUpperCase() as Tier);
  if (t < 0) return 0;
  const base = (t + 1) * 1000;
  if (t >= 7) return base + 400 + Math.min(lp, 3000); // apex tiers: LP is the whole story
  return base + (DIVISIONS[(division ?? "IV").toUpperCase()] ?? 0) * 100 + Math.min(lp, 100);
}

/** Lower-bound score for "tier or above" filtering. */
export const tierFloor = (tier: Tier) => (TIERS.indexOf(tier) + 1) * 1000;

export const ROLES = ["owner", "admin", "moderator", "booster", "customer"] as const;
export type Role = (typeof ROLES)[number];
const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, moderator: 2, booster: 1, customer: 0 };
export const roleAtLeast = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];
export const roleRank = (role: Role) => ROLE_RANK[role];
export const isStaff = (role: Role) => roleAtLeast(role, "moderator");

export const POOLS = ["booster", "community"] as const;
export type Pool = (typeof POOLS)[number];

export const GAME_ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"] as const;
