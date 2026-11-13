export type Role = "owner" | "admin" | "moderator" | "booster" | "customer";
export type Pool = "booster" | "community";

export interface Prefs {
  wallpaper?: string;
  compact?: boolean;
  reduceMotion?: boolean;
}

export interface PublicUser {
  id: number;
  username: string;
  avatarUrl: string | null;
  role: Role;
  trustRate: number;
  bio: string;
  mainRoles: string[];
  mainChampions: number[];
  banned: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface SelfUser extends PublicUser {
  prefs: Prefs;
  hasPassword: boolean;
  discordLinked: boolean;
  clientKey: string | null;
}

export interface Me {
  user: SelfUser | null;
  access?: Record<Pool, boolean>;
  subscriptionEndsAt?: number | null;
}

export interface Meta {
  siteName: string;
  discordInvite: string;
  discordLogin: boolean;
  passwordRegistration: boolean;
  ddragonVersion: string | null;
  servers: { code: string; label: string; graphs: string }[];
}

export interface Champion {
  key: number;
  id: string;
  name: string;
}

export interface QueueRank {
  tier: string | null;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
}

export interface Account {
  id: number;
  pool: Pool;
  active: boolean;
  riotId: string;
  server: string;
  level: number | null;
  profileIcon: number | null;
  solo: QueueRank;
  flex: QueueRank;
  be: number | null;
  rp: number | null;
  refunds: number | null;
  championCount: number;
  champions?: number[];
  flashOnF: boolean;
  banned: boolean;
  inGame: boolean;
  trustRequired: number;
  locked: boolean;
  inUse: boolean;
  inUseByMe: boolean;
  inUseBy: { id: number; username: string } | null;
  inUseSince: number | null;
  leaseExpiresAt: number | null;
  rankSyncedAt: number | null;
  storeSyncedAt: number | null;
  tokenStatus: "none" | "ok" | "invalid";
  owner: { id: number; username: string | null } | null;
  notes?: string;
  syncError?: string | null;
  hasPuuid?: boolean;
  hasToken?: boolean;
  createdAt: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActivityItem {
  id: number;
  action: string;
  createdAt: number;
  details?: Record<string, unknown> | string | null;
  userId?: number | null;
  username?: string | null;
  accountId?: number | null;
  riotId?: string | null;
  ip?: string | null;
}
