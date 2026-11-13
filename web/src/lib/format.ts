import type { QueueRank, Role } from "./types";

export const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"] as const;
export const GAME_ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"] as const;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function rankLabel(r: QueueRank): string {
  if (!r.tier) return "Unranked";
  return [cap(r.tier), r.division].filter(Boolean).join(" ");
}

export const rankImg = (tier: string | null) => `/images/ranks/${(tier ?? "unranked").toLowerCase()}.webp`;

export function winrate(r: { wins: number; losses: number }): number | null {
  const g = r.wins + r.losses;
  return g ? Math.round((r.wins / g) * 100) : null;
}

/** Tailwind text color for a rank tier. */
export function tierColor(tier: string | null): string {
  switch (tier) {
    case "IRON": return "text-stone-400";
    case "BRONZE": return "text-orange-300";
    case "SILVER": return "text-slate-300";
    case "GOLD": return "text-amber-300";
    case "PLATINUM": return "text-teal-300";
    case "EMERALD": return "text-emerald-300";
    case "DIAMOND": return "text-sky-300";
    case "MASTER": return "text-fuchsia-300";
    case "GRANDMASTER": return "text-rose-300";
    case "CHALLENGER": return "text-yellow-200";
    default: return "text-muted";
  }
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", moderator: "Moderator", booster: "Booster", customer: "Member" };
export const ROLE_STYLE: Record<Role, string> = {
  owner: "border-sakura/40 bg-sakura/10 text-sakura",
  admin: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  moderator: "border-sky/40 bg-sky/10 text-sky",
  booster: "border-violet/40 bg-violet/10 text-violet",
  customer: "border-line bg-white/5 text-muted",
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "never";
  const diff = (ms - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, sec] of units) if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
  return "just now";
}

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
export const fmtDateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

const DD = "https://ddragon.leagueoflegends.com/cdn";
export const profileIconUrl = (v: string | null, id: number | null) => (id && v ? `${DD}/${v}/img/profileicon/${id}.png` : "/images/logo.webp");
export const championIconUrl = (v: string | null, id: string) => `${DD}/${v ?? "15.1.1"}/img/champion/${id}.png`;

export function leagueOfGraphs(server: string, riotId: string): string {
  return `https://www.leagueofgraphs.com/summoner/${server}/${encodeURIComponent(riotId.replace("#", "-"))}`;
}
export function opgg(server: string, riotId: string): string {
  return `https://op.gg/lol/summoners/${server}/${encodeURIComponent(riotId.replace("#", "-"))}`;
}

export const ACTION_LABEL: Record<string, string> = {
  "account.claim": "Claimed",
  "account.release": "Released",
  "account.auto_release": "Auto-released",
  "account.force_release": "Force-released",
  "account.credentials": "Viewed login",
  "auth.login": "Signed in",
  "auth.register": "Registered",
  "auth.password_changed": "Changed password",
  "auth.discord_linked": "Linked Discord",
  "submission.created": "Lent an account",
  "client.key_regenerated": "New client key",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/^admin\./, "admin: ").replace(/[._]/g, " ");
