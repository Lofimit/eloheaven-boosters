import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Gamepad2, HandHeart, Megaphone, ShieldCheck, Sparkles, Users } from "lucide-react";
import { api } from "../lib/api";
import { actionLabel, fmtDate, timeAgo } from "../lib/format";
import { useMe, useTitle } from "../lib/hooks";
import type { Account } from "../lib/types";
import { AccountActions } from "../components/AccountActions";
import { ProfileIcon, RankBlock } from "../components/league";
import { Bar, Card, cx, Empty, PageHeader, RoleBadge, Stat } from "../components/ui";

interface DashboardData {
  access: { booster: boolean; community: boolean };
  subscriptionEndsAt: number | null;
  pools: Partial<Record<"booster" | "community", { total: number; available: number; inGame: number }>>;
  recent: { id: number; action: string; createdAt: number; accountId: number | null; riotId: string | null }[];
  submissions: { pending: number; approved: number };
  announcement: string;
  leaseHours: number;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  useTitle("Dashboard");
  const { data: me } = useMe();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardData>("/api/me/dashboard"), refetchInterval: 60_000 });
  const mine = useQuery({ queryKey: ["mine"], queryFn: () => api.get<{ items: Account[] }>("/api/accounts/mine"), refetchInterval: 60_000 });
  const u = me!.user!;
  const d = dash.data;

  return (
    <>
      <PageHeader
        kicker={greeting()}
        title={<>{u.username} <span className="text-gradient">✦</span></>}
        subtitle={<span className="flex items-center gap-2">Signed in as <RoleBadge role={u.role} /></span>}
      />

      {d?.announcement && (
        <div className="glass mb-6 flex gap-3 border-sakura/25 bg-gradient-to-r from-sakura/10 to-sky/5 p-4 animate-fade-up">
          <Megaphone className="mt-0.5 size-5 shrink-0 text-sakura" />
          <p className="text-sm whitespace-pre-line">{d.announcement}</p>
        </div>
      )}

      {/* Currently held accounts */}
      {(mine.data?.items.length ?? 0) > 0 && (
        <section className="mb-6 space-y-3">
          {mine.data!.items.map((a) => (
            <div key={a.id} className="glass relative overflow-hidden border-sakura/30 p-5 animate-fade-up">
              <div className="pointer-events-none absolute -top-20 -left-10 size-56 rounded-full bg-sakura/15 blur-3xl" />
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-sakura uppercase">
                <Gamepad2 className="size-4" /> You're playing
              </p>
              <div className="flex flex-wrap items-center gap-5">
                <Link to={`/account/${a.id}`} className="flex min-w-0 items-center gap-3">
                  <ProfileIcon id={a.profileIcon} level={a.level} />
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-bold hover:text-sakura">{a.riotId}</p>
                    <p className="text-xs text-muted">{a.server.toUpperCase()} · since {timeAgo(a.inUseSince)}</p>
                  </div>
                </Link>
                <div className="hidden md:block"><RankBlock label="Solo/Duo" r={a.solo} size="sm" /></div>
                <div className="ml-auto"><AccountActions a={a} compact /></div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {d?.access.booster && d.pools.booster && (
          <Stat icon={<Sparkles className="size-5" />} label="Booster pool" value={`${d.pools.booster.available}/${d.pools.booster.total}`} hint="available now" />
        )}
        <Stat
          icon={<Users className="size-5" />}
          label="Community pool"
          value={d?.access.community && d.pools.community ? `${d.pools.community.available}/${d.pools.community.total}` : "Locked"}
          hint={d?.access.community ? "available now" : "subscription required"}
        />
        <Stat
          icon={<CalendarClock className="size-5" />}
          label="Subscription"
          value={d?.subscriptionEndsAt ? "Active" : "None"}
          hint={d?.subscriptionEndsAt ? `until ${fmtDate(d.subscriptionEndsAt)}` : "ask staff on Discord"}
        />
        <div className="glass p-4">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"><ShieldCheck className="size-4 text-sakura" /> Trust rate</p>
          <p className="mt-1 font-display text-2xl font-bold">{u.trustRate}%</p>
          <Bar value={u.trustRate} className="mt-2" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Jump in</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {d?.access.booster && <QuickLink to="/accounts/booster" title="Booster accounts" text="Staff & booster pool" icon={<Sparkles className="size-5" />} />}
            <QuickLink
              to="/accounts/community"
              title="Community accounts"
              text={d?.access.community ? "Shared by members" : "Requires a subscription"}
              icon={<Users className="size-5" />}
              dim={!d?.access.community}
            />
            <QuickLink to="/lend" title="Lend an account" text={d?.submissions.pending ? `${d.submissions.pending} waiting for review` : "Share yours with the community"} icon={<HandHeart className="size-5" />} />
            <QuickLink to="/rules" title="Read the rules" text={`Leases last ${d?.leaseHours ?? 3}h, play fair`} icon={<ShieldCheck className="size-5" />} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-bold">Recent activity</h2>
          {!d?.recent.length ? (
            <Empty title="Nothing yet">Claim an account and it'll show up here.</Empty>
          ) : (
            <ul className="space-y-3">
              {d.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-muted">{actionLabel(r.action)}</span>{" "}
                    {r.accountId ? <Link className="font-medium hover:text-sakura" to={`/account/${r.accountId}`}>{r.riotId}</Link> : <span>{r.riotId ?? "deleted account"}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function QuickLink({ to, title, text, icon, dim }: { to: string; title: string; text: string; icon: React.ReactNode; dim?: boolean }) {
  return (
    <Link to={to} className={cx("group flex items-center gap-4 rounded-xl border border-line bg-white/[0.02] p-4 transition hover:border-sakura/30 hover:bg-white/[0.05]", dim && "opacity-60")}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sakura/15 to-sky/15 text-sakura">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted">{text}</span>
      </span>
      <ArrowRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-sakura" />
    </Link>
  );
}
