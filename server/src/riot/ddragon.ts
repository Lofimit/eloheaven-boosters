import { state } from "../settings.js";

export interface Champion {
  key: number; // numeric champion id used by Riot APIs
  id: string; // image/asset id, e.g. "MonkeyKing"
  name: string; // display name, e.g. "Wukong"
}

interface Cache {
  version: string;
  champions: Champion[];
  fetchedAt: number;
}

const TTL = 12 * 3600_000;
let cache: Cache | null = state.get<Cache>("ddragon");
let inflight: Promise<Cache | null> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function refresh(): Promise<Cache | null> {
  try {
    const versions = await fetchJson<string[]>("https://ddragon.leagueoflegends.com/api/versions.json");
    const version = versions[0]!;
    const data = await fetchJson<{ data: Record<string, { key: string; id: string; name: string }> }>(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
    );
    const champions = Object.values(data.data)
      .map((c) => ({ key: Number(c.key), id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cache = { version, champions, fetchedAt: Date.now() };
    state.set("ddragon", cache);
    rebuildIndex();
    return cache;
  } catch (err) {
    console.warn("[ddragon] refresh failed:", (err as Error).message);
    return cache;
  }
}

let byKey = new Map<number, Champion>();
let byName = new Map<string, Champion>();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function rebuildIndex() {
  byKey = new Map(cache?.champions.map((c) => [c.key, c]) ?? []);
  byName = new Map();
  for (const c of cache?.champions ?? []) {
    byName.set(norm(c.name), c);
    byName.set(norm(c.id), c);
  }
}
rebuildIndex();

export async function getDDragon(): Promise<Cache | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL) return cache;
  if (!inflight) inflight = refresh().finally(() => (inflight = null));
  // Serve stale data immediately if we have any.
  return cache ?? (await inflight);
}

export const championByKey = (key: number) => byKey.get(key);
export const championByName = (name: string) => byName.get(norm(name));
export const ddragonVersion = () => cache?.version ?? "15.1.1";
