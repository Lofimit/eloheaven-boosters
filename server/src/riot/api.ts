import { config } from "../config.js";
import { riotApiKey, state } from "../settings.js";
import { SERVERS, type ServerCode } from "../lib/league.js";

/** Thrown when the API key is missing/expired so jobs can stop early instead of hammering Riot. */
export class RiotKeyError extends Error {}

export class RiotHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Simple serial queue: guarantees spacing between calls (dev keys allow 100 req / 2 min).
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCall + config.riotMinIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

export type KeyStatus = { ok: boolean; message: string; checkedAt: number };
export const keyStatus = () => state.get<KeyStatus>("riotKeyStatus");
function setKeyStatus(ok: boolean, message: string) {
  const prev = keyStatus();
  if (prev?.ok === ok && prev.message === message && Date.now() - prev.checkedAt < 60_000) return;
  state.set("riotKeyStatus", { ok, message, checkedAt: Date.now() });
}

async function riotGet<T>(host: string, path: string, attempt = 0): Promise<T | null> {
  const key = riotApiKey();
  if (!key) throw new RiotKeyError("No Riot API key configured");
  const res = await schedule(() =>
    fetch(`https://${host}.api.riotgames.com${path}`, {
      headers: { "X-Riot-Token": key },
      signal: AbortSignal.timeout(15_000),
    }),
  );
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    setKeyStatus(false, `Riot rejected the API key (${res.status}). Dev keys expire every 24h.`);
    throw new RiotKeyError(`Riot API key rejected (${res.status})`);
  }
  if (res.status === 429 && attempt < 3) {
    const retry = Number(res.headers.get("retry-after") ?? "10");
    await new Promise((r) => setTimeout(r, Math.min(Math.max(retry, 1), 120) * 1000));
    return riotGet(host, path, attempt + 1);
  }
  if (res.status >= 500 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return riotGet(host, path, attempt + 1);
  }
  if (!res.ok) throw new RiotHttpError(res.status, `Riot API ${res.status} on ${path}`);
  setKeyStatus(true, "OK");
  return (await res.json()) as T;
}

export interface RiotAccount {
  puuid: string;
  gameName?: string;
  tagLine?: string;
}
export interface Summoner {
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
}
export interface LeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export function splitRiotId(riotId: string): { name: string; tag: string } | null {
  const i = riotId.lastIndexOf("#");
  if (i <= 0 || i === riotId.length - 1) return null;
  return { name: riotId.slice(0, i).trim(), tag: riotId.slice(i + 1).trim() };
}

export const riot = {
  accountByRiotId(server: ServerCode, riotId: string) {
    const parts = splitRiotId(riotId);
    if (!parts) return Promise.resolve(null);
    return riotGet<RiotAccount>(
      SERVERS[server].region,
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(parts.name)}/${encodeURIComponent(parts.tag)}`,
    );
  },
  accountByPuuid(server: ServerCode, puuid: string) {
    return riotGet<RiotAccount>(SERVERS[server].region, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`);
  },
  summoner(server: ServerCode, puuid: string) {
    return riotGet<Summoner>(SERVERS[server].platform, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`);
  },
  leagues(server: ServerCode, puuid: string) {
    return riotGet<LeagueEntry[]>(SERVERS[server].platform, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);
  },
  /** Returns true if the player is currently in a game. */
  async inGame(server: ServerCode, puuid: string) {
    const game = await riotGet<unknown>(SERVERS[server].platform, `/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`);
    return game !== null;
  },
};
