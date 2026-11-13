import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Ban, Gamepad2, Lock, Search, Swords, UserRound, X } from "lucide-react";
import { useChampions } from "../lib/hooks";
import { championIconUrl, num, profileIconUrl, rankImg, rankLabel, tierColor, winrate } from "../lib/format";
import type { Account, QueueRank } from "../lib/types";
import { cx } from "./ui";

export function RankBlock({ label, r, size = "md" }: { label: string; r: QueueRank; size?: "sm" | "md" | "lg" }) {
  const wr = winrate(r);
  const img = size === "lg" ? "size-20" : size === "md" ? "size-12" : "size-9";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img src={rankImg(r.tier)} alt="" loading="lazy" className={cx(img, "shrink-0 object-contain drop-shadow-[0_0_10px_rgb(244_170_255_/_0.15)]")} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-widest text-muted uppercase">{label}</p>
        <p className={cx("truncate font-display font-bold", tierColor(r.tier), size === "lg" ? "text-2xl" : "text-sm")}>
          {rankLabel(r)}
          {r.tier && <span className="ml-1.5 font-sans text-xs font-medium text-muted">{r.lp} LP</span>}
        </p>
        {r.wins + r.losses > 0 && (
          <p className="text-xs text-muted">
            {r.wins}W {r.losses}L · <span className={cx(wr !== null && wr >= 55 ? "text-ok" : wr !== null && wr < 48 ? "text-bad" : "")}>{wr}%</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function ProfileIcon({ id, level, size = "size-14" }: { id: number | null; level: number | null; size?: string }) {
  const { version } = useChampions();
  return (
    <div className="relative shrink-0">
      <img src={profileIconUrl(version, id)} alt="" loading="lazy" className={cx(size, "rounded-2xl border border-sakura/30 object-cover")} />
      {level !== null && (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-sakura/40 bg-ink px-1.5 text-[10px] leading-4 font-bold">{level}</span>
      )}
    </div>
  );
}

export function AccountCard({ a, index = 0 }: { a: Account; index?: number }) {
  const unavailable = a.banned || (a.inUse && !a.inUseByMe);
  return (
    <Link
      to={`/account/${a.id}`}
      className={cx("glass glass-hover group relative block overflow-hidden p-4 animate-fade-up", unavailable && "opacity-70")}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-sakura/10 blur-3xl transition group-hover:bg-sakura/20" />
      <div className="flex items-start gap-3">
        <ProfileIcon id={a.profileIcon} level={a.level} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold" title={a.riotId}>
            {a.riotId}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="chip">{a.server.toUpperCase()}</span>
            {a.inGame && (
              <span className="chip border-ok/30 text-ok">
                <Gamepad2 className="size-3" /> In game
              </span>
            )}
            {a.trustRequired > 0 && (
              <span className={cx("chip", a.locked && "border-warn/30 text-warn")}>
                {a.locked && <Lock className="size-3" />} {a.trustRequired}% trust
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <RankBlock label="Solo/Duo" r={a.solo} size="sm" />
        <RankBlock label="Flex" r={a.flex} size="sm" />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5" title="Blue Essence">
          <img src="/images/be.webp" alt="" className="size-4" /> {num(a.be)}
        </span>
        <span className="flex items-center gap-1.5" title="Champions">
          <Swords className="size-3.5" /> {a.championCount || "—"}
        </span>
        <StatusPill a={a} />
      </div>
    </Link>
  );
}

export function StatusPill({ a }: { a: Account }) {
  if (a.banned) return <span className="flex items-center gap-1 font-semibold text-bad"><Ban className="size-3.5" /> Banned</span>;
  if (a.inUseByMe) return <span className="font-semibold text-sakura">Yours</span>;
  if (a.inUse) return <span className="flex items-center gap-1 font-semibold text-warn"><UserRound className="size-3.5" /> {a.inUseBy?.username}</span>;
  return <span className="font-semibold text-ok">Available</span>;
}

export function ChampionIcon({ champKey, size = "size-10", title = true }: { champKey: number; size?: string; title?: boolean }) {
  const { byKey, version } = useChampions();
  const c = byKey.get(champKey);
  if (!c) return <div className={cx(size, "rounded-lg bg-white/5")} />;
  return <img src={championIconUrl(version, c.id)} alt={c.name} title={title ? c.name : undefined} loading="lazy" className={cx(size, "rounded-lg border border-line object-cover")} />;
}

/** Searchable champion multi-select. */
export function ChampionPicker({ value, onChange, max }: { value: number[]; onChange: (v: number[]) => void; max?: number }) {
  const { champions, version, byKey } = useChampions();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? champions.filter((c) => c.name.toLowerCase().includes(s)) : champions;
  }, [champions, q]);
  const selected = new Set(value);
  const toggle = (k: number) => {
    if (selected.has(k)) onChange(value.filter((v) => v !== k));
    else if (!max || value.length < max) onChange([...value, k]);
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {value.map((k) => (
            <button key={k} type="button" onClick={() => toggle(k)} className="chip border-sakura/30 text-text hover:border-bad/40">
              {byKey.get(k)?.name ?? k} <X className="size-3" />
            </button>
          ))}
        </div>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder={`Search ${champions.length} champions…`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid max-h-64 grid-cols-6 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-8 md:grid-cols-10">
        {list.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            title={c.name}
            className={cx(
              "relative overflow-hidden rounded-lg border-2 transition",
              selected.has(c.key) ? "border-sakura shadow-[0_0_12px_rgb(244_170_255_/_0.4)]" : "border-transparent opacity-70 hover:opacity-100",
            )}
          >
            <img src={championIconUrl(version, c.id)} alt={c.name} loading="lazy" className="aspect-square w-full" />
          </button>
        ))}
      </div>
      {max && <p className="mt-2 text-xs text-muted">{value.length}/{max} selected</p>}
    </div>
  );
}
