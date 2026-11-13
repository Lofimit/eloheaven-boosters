import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ban, ExternalLink, Gamepad2, Info, Search, ShieldAlert, Swords } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { actionLabel, fmtDateTime, leagueOfGraphs, num, opgg, timeAgo } from "../lib/format";
import { useChampions, useTitle } from "../lib/hooks";
import type { Account, ActivityItem } from "../lib/types";
import { AccountActions } from "../components/AccountActions";
import { ChampionIcon, ProfileIcon, RankBlock, StatusPill } from "../components/league";
import { Card, cx, Empty, Modal, PageLoader } from "../components/ui";

export default function AccountDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["account", id],
    queryFn: () => api.get<{ account: Account; history?: ActivityItem[] }>(`/api/accounts/${id}`),
    refetchInterval: 30_000,
  });
  const [champsOpen, setChampsOpen] = useState(false);
  useTitle(q.data?.account.riotId ?? "Account");

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data)
    return (
      <div className="glass">
        <Empty icon={<ShieldAlert className="size-10" />} title="Can't open this account">
          {q.error instanceof ApiError ? q.error.message : "It may have been removed."}
          <div className="mt-4"><Link to="/dashboard" className="btn btn-ghost">Back to dashboard</Link></div>
        </Empty>
      </div>
    );

  const a = q.data.account;
  const storeKnown = a.be !== null || a.rp !== null || a.championCount > 0;

  return (
    <div className="space-y-6">
      <Link to={`/accounts/${a.pool}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> {a.pool === "booster" ? "Booster" : "Community"} accounts
      </Link>

      {/* Hero */}
      <section className="glass relative overflow-hidden p-6 animate-fade-up sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-sakura/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 size-60 rounded-full bg-sky/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-6">
          <ProfileIcon id={a.profileIcon} level={a.level} size="size-24" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-bold sm:text-4xl">{a.riotId}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="chip">{a.server.toUpperCase()}</span>
              {a.inGame ? (
                <span className="chip border-ok/30 text-ok"><Gamepad2 className="size-3" /> In game</span>
              ) : (
                <span className="chip">Offline</span>
              )}
              {a.trustRequired > 0 && <span className={cx("chip", a.locked && "border-warn/30 text-warn")}>{a.trustRequired}% trust required</span>}
              {a.owner?.username && <span className="chip">Lent by <Link className="text-text hover:text-sakura" to={`/u/${a.owner.id}`}>{a.owner.username}</Link></span>}
              <span className="text-xs"><StatusPill a={a} /></span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <a className="flex items-center gap-1 text-muted hover:text-sky" href={leagueOfGraphs(a.server, a.riotId)} target="_blank" rel="noreferrer">League of Graphs <ExternalLink className="size-3" /></a>
              <a className="flex items-center gap-1 text-muted hover:text-sky" href={opgg(a.server, a.riotId)} target="_blank" rel="noreferrer">OP.GG <ExternalLink className="size-3" /></a>
            </div>
          </div>
        </div>
        {a.banned && (
          <div className="relative mt-6 flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
            <Ban className="size-4" /> This account is banned and can't be used.
          </div>
        )}
        <div className="relative mt-6 border-t border-line pt-6">
          <AccountActions a={a} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-5 text-lg font-bold">Ranked</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <RankBlock label="Solo / Duo" r={a.solo} size="lg" />
            <RankBlock label="Flex 5v5" r={a.flex} size="lg" />
          </div>
          <p className="mt-6 text-xs text-muted">Updated {timeAgo(a.rankSyncedAt)} from Riot's official API.</p>
          {a.syncError && <p className="mt-2 text-xs text-warn">Last sync problem: {a.syncError}</p>}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-bold">Wallet & extras</h2>
          <div className="grid grid-cols-3 gap-2">
            <Currency img="/images/be.webp" label="BE" value={num(a.be)} />
            <Currency img="/images/rp.webp" label="RP" value={num(a.rp)} />
            <Currency img="/images/refund.webp" label="Refunds" value={num(a.refunds)} />
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-muted"><img src="/images/flash.webp" alt="" className="size-5 rounded" /> Flash key</span>
            <span className="flex gap-1">
              {(["D", "F"] as const).map((k) => (
                <span key={k} className={cx("kbd px-2.5 py-1 text-xs", (k === "F") === a.flashOnF ? "border-sakura/50 bg-sakura/15 text-sakura" : "opacity-40")}>{k}</span>
              ))}
            </span>
          </div>
          {!storeKnown && (
            <p className="mt-3 flex gap-2 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> Riot doesn't expose wallet data publicly, so staff fill this in by hand.
            </p>
          )}
          {a.storeSyncedAt && <p className="mt-3 text-xs text-muted">Wallet synced {timeAgo(a.storeSyncedAt)}.</p>}
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Swords className="size-5 text-sakura" /> Champions <span className="text-sm font-medium text-muted">{a.championCount || ""}</span></h2>
          {(a.champions?.length ?? 0) > 24 && <button className="btn btn-ghost btn-sm" onClick={() => setChampsOpen(true)}>View all</button>}
        </div>
        {a.champions?.length ? (
          <div className="flex flex-wrap gap-2">
            {a.champions.slice(0, 24).map((k) => <ChampionIcon key={k} champKey={k} size="size-11" />)}
          </div>
        ) : (
          <p className="text-sm text-muted">Champion list not available for this account.</p>
        )}
      </Card>

      {q.data.history && (
        <Card>
          <h2 className="mb-4 text-lg font-bold">History <span className="text-xs font-medium text-muted">(staff only)</span></h2>
          {q.data.history.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {q.data.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {h.userId ? <Link className="font-medium hover:text-sakura" to={`/u/${h.userId}`}>{h.username}</Link> : <span className="text-muted">system</span>}{" "}
                    <span className="text-muted">{actionLabel(h.action).toLowerCase()}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted" title={fmtDateTime(h.createdAt)}>{timeAgo(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ChampionsModal open={champsOpen} onClose={() => setChampsOpen(false)} keys={a.champions ?? []} />
    </div>
  );
}

function Currency({ img, label, value }: { img: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-center">
      <img src={img} alt="" className="mx-auto size-7" />
      <p className="mt-1.5 font-display font-bold">{value}</p>
      <p className="text-[10px] tracking-widest text-muted uppercase">{label}</p>
    </div>
  );
}

function ChampionsModal({ open, onClose, keys }: { open: boolean; onClose: () => void; keys: number[] }) {
  const { byKey } = useChampions();
  const [q, setQ] = useState("");
  const list = useMemo(
    () => keys.map((k) => byKey.get(k)).filter((c): c is NonNullable<typeof c> => Boolean(c)).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).sort((x, y) => x.name.localeCompare(y.name)),
    [keys, byKey, q],
  );
  return (
    <Modal open={open} onClose={onClose} title={`Champions (${keys.length})`} wide>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
        {list.map((c) => (
          <div key={c.key} className="flex flex-col items-center gap-1 text-center">
            <ChampionIcon champKey={c.key} size="size-14" title={false} />
            <span className="w-full truncate text-[11px] text-muted">{c.name}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
