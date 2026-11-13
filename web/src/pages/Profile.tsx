import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, HandHeart, Pencil, Swords } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate, timeAgo } from "../lib/format";
import { useMe, useTitle } from "../lib/hooks";
import type { PublicUser } from "../lib/types";
import { ChampionIcon } from "../components/league";
import { Avatar, Bar, Card, Empty, PageLoader, RoleBadge } from "../components/ui";

export default function Profile() {
  const params = useParams();
  const { data: me } = useMe();
  const id = params.id ?? String(me?.user?.id);
  const q = useQuery({ queryKey: ["user", id], queryFn: () => api.get<{ user: PublicUser; stats: { claims: number; lent: number } }>(`/api/users/${id}`) });
  useTitle(q.data?.user.username ?? "Profile");
  if (q.isLoading) return <PageLoader />;
  if (!q.data) return <div className="glass"><Empty title="User not found" /></div>;
  const { user: u, stats } = q.data;
  const isMe = me?.user?.id === u.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="glass relative overflow-hidden animate-fade-up">
        <div className="h-28 bg-gradient-to-r from-sakura/30 via-violet/20 to-sky/30" />
        <div className="px-6 pb-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
            <Avatar src={u.avatarUrl} name={u.username} size="size-24" className="border-4 border-panel text-3xl" />
            {isMe && <Link to="/settings" className="btn btn-ghost btn-sm"><Pencil className="size-3.5" /> Edit profile</Link>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{u.username}</h1>
            <RoleBadge role={u.role} />
            {u.banned && <span className="chip border-bad/30 text-bad">Banned</span>}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><CalendarDays className="size-4" /> Joined {fmtDate(u.createdAt)} · seen {timeAgo(u.lastSeenAt)}</p>
          <p className="mt-4 whitespace-pre-line text-text/90 italic">{u.bio ? `“${u.bio}”` : <span className="text-muted not-italic">No bio yet.</span>}</p>
        </div>
      </section>

      <div className="grid gap-6 sm:grid-cols-3">
        <Card>
          <p className="label">Trust rate</p>
          <p className="font-display text-3xl font-bold">{u.trustRate}%</p>
          <Bar value={u.trustRate} className="mt-3" />
        </Card>
        <Card>
          <p className="label flex items-center gap-1.5"><Swords className="size-3.5" /> Games claimed</p>
          <p className="font-display text-3xl font-bold">{stats.claims}</p>
        </Card>
        <Card>
          <p className="label flex items-center gap-1.5"><HandHeart className="size-3.5" /> Accounts lent</p>
          <p className="font-display text-3xl font-bold">{stats.lent}</p>
        </Card>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-bold">Main roles</h2>
          {u.mainRoles.length ? (
            <div className="flex flex-wrap gap-3">
              {u.mainRoles.map((r) => (
                <div key={r} className="flex flex-col items-center gap-1">
                  <img src={`/images/roles/${r.toLowerCase()}.webp`} alt="" className="size-12" />
                  <span className="text-xs text-muted">{r}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted">None picked.</p>}
        </Card>
        <Card>
          <h2 className="mb-4 font-bold">Main champions</h2>
          {u.mainChampions.length ? (
            <div className="flex gap-3">{u.mainChampions.map((k) => <ChampionIcon key={k} champKey={k} size="size-14" />)}</div>
          ) : <p className="text-sm text-muted">None picked.</p>}
        </Card>
      </div>
    </div>
  );
}
