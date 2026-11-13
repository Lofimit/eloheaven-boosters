/**
 * Legacy client-token sync (BE / RP / refunds / owned champions / bans).
 *
 * Riot no longer supports refreshing client tokens this way, so nearly every
 * token will fail. We try once; on failure the token is marked invalid and is
 * never retried until an admin pastes a new one. Rank data does NOT depend on this.
 */
import type { ServerCode } from "../lib/league.js";
import { championByName } from "./ddragon.js";

const STORE_HOSTS: Partial<Record<ServerCode, string>> = {
  br: "br", eune: "eune", euw: "euw", jp: "jp", kr: "kr", lan: "la1", las: "la2", me: "me1",
  na: "na", oce: "oc", ru: "ru", sg: "sg", tr: "tr", tw: "tw", vn: "vn",
};

export interface StoreData {
  refreshToken: string;
  level?: number;
  profileIcon?: number;
  be?: number;
  rp?: number;
  refunds?: number;
  champions?: number[];
  banned?: boolean;
  banInfo?: string | null;
}

export class TokenInvalidError extends Error {}

function decodeJwtPayload(token: string): any {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const CLIENT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) LeagueOfLegendsClient (CEF 108) Safari/537.36";

export async function syncWithRefreshToken(server: ServerCode, refreshToken: string): Promise<StoreData> {
  const tokenRes = await fetch("https://auth.riotgames.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "lol", grant_type: "refresh_token", refresh_token: refreshToken }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!tokenRes || !tokenRes.ok) throw new TokenInvalidError(`token refresh failed (${tokenRes?.status ?? "network"})`);
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token) throw new TokenInvalidError("no access token returned");

  const out: StoreData = { refreshToken: tokens.refresh_token ?? refreshToken };
  const auth = { Authorization: `Bearer ${tokens.access_token}` };

  // Each piece is best-effort: a failure here keeps whatever data we already had.
  try {
    const info = await fetch("https://auth.riotgames.com/userinfo", { headers: auth, signal: AbortSignal.timeout(15_000) });
    if (info.ok) {
      const payload = decodeJwtPayload(await info.text());
      if (payload?.lol_account) {
        out.level = payload.lol_account.summoner_level;
        out.profileIcon = payload.lol_account.profile_icon;
      }
      const restrictions: any[] = payload?.ban?.restrictions ?? [];
      const ban = restrictions.find((r) => r?.type === "PERMANENT_BAN" || r?.type === "TIME_BAN");
      out.banned = Boolean(ban);
      out.banInfo = ban ? JSON.stringify(ban) : null;
    }
  } catch {}

  const host = STORE_HOSTS[server];
  if (host) {
    const headers = { ...auth, "User-Agent": CLIENT_UA };
    try {
      const r = await fetch(`https://${host}-red.lol.sgp.pvp.net/storefront/v3/history/purchase`, { headers, signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const d = (await r.json()) as any;
        out.rp = d?.player?.rp;
        out.be = d?.player?.ip;
        out.refunds = d?.refundCreditsRemaining;
      }
    } catch {}
    try {
      const r = await fetch(`https://${host}-red.lol.sgp.pvp.net/storefront/v3/view/champions`, { headers, signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const d = (await r.json()) as any;
        const owned: number[] = [];
        for (const c of d?.catalog ?? []) {
          if (!c?.owned) continue;
          const key = Number(c.itemId) || championByName(String(c.name ?? ""))?.key;
          if (key) owned.push(key);
        }
        out.champions = owned;
      }
    } catch {}
  }
  return out;
}
