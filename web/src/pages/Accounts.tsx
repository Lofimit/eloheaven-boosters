import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { api, ApiError, qs } from "../lib/api";
import { cap, TIERS } from "../lib/format";
import { useChampions, useDebounced, useMe, useMeta, useTitle } from "../lib/hooks";
import type { Account, Paged, Pool } from "../lib/types";
import { AccountCard } from "../components/league";
import { cx, Empty, PageHeader, Pagination } from "../components/ui";

type Resp = Paged<Account> & { poolStats: { total: number; available: number } };

const SORTS = [
  ["rank", "Highest rank"],
  ["games", "Most games"],
  ["winrate", "Best winrate"],
  ["champions", "Most champions"],
  ["be", "Most BE"],
  ["level", "Highest level"],
  ["recent", "Newest"],
] as const;

export default function Accounts() {
  const params = useParams();
  const pool = params.pool as Pool;
  const { data: me } = useMe();
  const meta = useMeta();
  const { champions } = useChampions();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const debounced = useDebounced(search);
  const [showFilters, setShowFilters] = useState(false);
  useTitle(pool === "booster" ? "Booster accounts" : "Community accounts");

  const get = (k: string) => sp.get(k) ?? "";
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!("page" in patch)) next.delete("page");
    setSp(next, { replace: true });
  };
  useEffect(() => {
    if (debounced !== (sp.get("q") ?? "")) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const page = Number(get("page") || 1);
  const filters = { pool, server: get("server"), tier: get("tier"), champion: get("champion"), minBe: get("minBe"), available: get("available"), q: get("q"), sort: get("sort") || "rank", page };
  const allowed = me?.access?.[pool];

  const q = useQuery({
    queryKey: ["accounts", filters],
    queryFn: () => api.get<Resp>(`/api/accounts${qs(filters)}`),
    placeholderData: keepPreviousData,
    enabled: Boolean(allowed),
    refetchInterval: 45_000,
  });

  if (pool !== "booster" && pool !== "community") return <Navigate to="/dashboard" replace />;

  const activeCount = ["server", "tier", "champion", "minBe", "available"].filter((k) => get(k)).length;

  return (
    <>
      <PageHeader
        kicker={pool === "booster" ? "Booster pool" : "Community pool"}
        title={pool === "booster" ? "Booster accounts" : "Community accounts"}
        subtitle={q.data ? `${q.data.poolStats.available} of ${q.data.poolStats.total} accounts available right now` : "Pick an account, play, release it when you're done."}
      />

      {!allowed ? (
        <div className="glass">
          <Empty icon={<Lock className="size-10" />} title={pool === "community" ? "Subscription required" : "Boosters only"}>
            {pool === "community" ? (
              <>Community accounts are available to subscribers. Ask the staff on <a className="text-sakura hover:underline" href={meta.data?.discordInvite} target="_blank" rel="noreferrer">Discord</a> to get access.</>
            ) : (
              "This pool is reserved for boosters and staff."
            )}
          </Empty>
        </div>
      ) : (
        <>
          <div className="glass mb-6 p-3 sm:p-4">
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input className="input pl-9" placeholder="Search Riot ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input w-auto" value={filters.sort} onChange={(e) => set({ sort: e.target.value === "rank" ? "" : e.target.value })} aria-label="Sort">
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className={cx("btn btn-ghost", activeCount && "border-sakura/40 text-sakura")} onClick={() => setShowFilters((s) => !s)}>
                <SlidersHorizontal className="size-4" /> Filters{activeCount ? ` (${activeCount})` : ""}
              </button>
              <button className={cx("btn btn-ghost", get("available") && "border-ok/40 text-ok")} onClick={() => set({ available: get("available") ? "" : "1" })}>
                Available only
              </button>
            </div>
            {showFilters && (
              <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4 animate-fade">
                <select className="input" value={get("server")} onChange={(e) => set({ server: e.target.value })} aria-label="Server">
                  <option value="">All servers</option>
                  {meta.data?.servers.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
                <select className="input" value={get("tier")} onChange={(e) => set({ tier: e.target.value })} aria-label="Rank">
                  <option value="">Any rank</option>
                  <option value="UNRANKED">Unranked</option>
                  {TIERS.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
                </select>
                <select className="input" value={get("champion")} onChange={(e) => set({ champion: e.target.value })} aria-label="Champion owned">
                  <option value="">Any champion</option>
                  {champions.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
                <select className="input" value={get("minBe")} onChange={(e) => set({ minBe: e.target.value })} aria-label="Minimum BE">
                  <option value="">Any BE</option>
                  {[450, 1350, 3150, 4800, 6300, 10000].map((b) => <option key={b} value={b}>{b.toLocaleString()}+ BE</option>)}
                </select>
                {activeCount > 0 && (
                  <button className="btn btn-ghost sm:col-span-2 lg:col-span-4" onClick={() => set({ server: "", tier: "", champion: "", minBe: "", available: "" })}>
                    <X className="size-4" /> Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          {q.error ? (
            <div className="glass"><Empty title="Couldn't load accounts">{q.error instanceof ApiError ? q.error.message : "Try again in a moment."}</Empty></div>
          ) : q.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-52 rounded-2xl" />)}
            </div>
          ) : !q.data?.items.length ? (
            <div className="glass"><Empty icon={<Users className="size-10" />} title="No accounts match">Try loosening the filters.</Empty></div>
          ) : (
            <div className={cx("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", q.isPlaceholderData && "opacity-60 transition-opacity")}>
              {q.data.items.map((a, i) => <AccountCard key={a.id} a={a} index={i} />)}
            </div>
          )}
          {q.data && <Pagination page={page} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
        </>
      )}
    </>
  );
}
