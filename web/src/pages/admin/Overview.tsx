import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Inbox, RefreshCw, Swords, Users } from "lucide-react";
import { api } from "../../lib/api";
import { duration, timeAgo } from "../../lib/format";
import type { Account } from "../../lib/types";
import { Card, ConfirmButton, cx, Spinner, Stat, useToast } from "../../components/ui";

interface OverviewData {
  accounts: { total: number; active: number; inUse: number; banned: number; syncErrors: number; inGame: number; booster: number; community: number };
  users: { total: number; active7d: number; new7d: number; banned: number };
  activeSubscriptions: number;
  pendingSubmissions: number;
  claimsPerDay: { day: string; claims: number }[];
  inUse: Account[];
  system: {
    refresh: { running: boolean; startedAt: number | null; finishedAt: number | null; done: number; total: number; failed: number; lastError: string | null };
    riotKey: { ok: boolean; message: string; checkedAt: number } | null;
    dbBytes: number;
    uptimeSec: number;
    memoryMb: number;
  };
}

export default function Overview() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<OverviewData>("/api/admin/overview"),
    refetchInterval: (query) => (query.state.data?.system.refresh.running ? 3000 : 30_000),
  });
  const refreshAll = useMutation({
    mutationFn: () => api.post("/api/admin/refresh-all"),
    onSuccess: () => {
      toast("info", "Rank refresh started");
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
  const release = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/accounts/${id}/release`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "overview"] }),
  });

  if (!q.data) return <div className="grid place-items-center py-20"><Spinner /></div>;
  const d = q.data;
  const r = d.system.refresh;
  const byDay = new Map(d.claimsPerDay.map((c) => [c.day, c.claims]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(Date.now() - (13 - i) * 86400_000).toISOString().slice(0, 10);
    return { day, claims: byDay.get(day) ?? 0 };
  });
  const max = Math.max(1, ...days.map((c) => c.claims));

  return (
    <div className="space-y-6">
      {!d.system.riotKey?.ok && (
        <div className="glass flex items-start gap-3 border-warn/30 bg-warn/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" />
          <div>
            <p className="font-semibold text-warn">Riot API key needs attention</p>
            <p className="text-muted">{d.system.riotKey?.message ?? "No key has been used yet. Add one in Settings so ranks stay up to date."}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Swords className="size-5" />} label="Accounts" value={d.accounts.total} hint={`${d.accounts.booster} booster · ${d.accounts.community} community`} />
        <Stat icon={<CheckCircle2 className="size-5" />} label="In use" value={d.accounts.inUse} hint={`${d.accounts.inGame} in game · ${d.accounts.banned} banned`} />
        <Stat icon={<Users className="size-5" />} label="Users" value={d.users.total} hint={`${d.users.active7d} active · ${d.users.new7d} new this week`} />
        <Link to="/admin/submissions">
          <Stat icon={<Inbox className="size-5" />} label="Pending submissions" value={d.pendingSubmissions} hint={`${d.activeSubscriptions} active subscriptions`} />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 font-bold">Accounts in use</h2>
          {d.inUse.length === 0 ? (
            <p className="text-sm text-muted">Nobody is playing right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted uppercase">
                  <tr><th className="pb-2">Account</th><th className="pb-2">User</th><th className="pb-2">For</th><th className="pb-2">Lease</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.inUse.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2"><Link className="font-medium hover:text-sakura" to={`/account/${a.id}`}>{a.riotId}</Link> {a.inGame && <span className="chip ml-1 border-ok/30 text-ok">in game</span>}</td>
                      <td className="py-2">{a.inUseBy && <Link className="hover:text-sakura" to={`/u/${a.inUseBy.id}`}>{a.inUseBy.username}</Link>}</td>
                      <td className="py-2 text-muted">{a.inUseSince ? duration(Date.now() - a.inUseSince) : "—"}</td>
                      <td className="py-2 text-muted">{a.leaseExpiresAt ? duration(a.leaseExpiresAt - Date.now()) : "—"}</td>
                      <td className="py-2 text-right">
                        <ConfirmButton className="btn btn-danger btn-sm" confirmText="Confirm" onConfirm={() => release.mutate(a.id)}>Force release</ConfirmButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-bold">Claims (14 days)</h2>
          {d.claimsPerDay.length === 0 ? (
            <p className="text-sm text-muted">No claims yet.</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {days.map((c) => (
                <div key={c.day} className="group relative flex-1">
                  <div className="rounded-t bg-gradient-to-t from-sakura/50 to-sky/70" style={{ height: `${Math.max(2, (c.claims / max) * 120)}px` }} />
                  <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 text-[10px] whitespace-nowrap group-hover:block">{c.day.slice(5)}: {c.claims}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-bold">Rank sync</h2>
            <p className="text-sm text-muted">
              {r.running ? `Running… ${r.done}/${r.total}` : r.finishedAt ? `Last run ${timeAgo(r.finishedAt)}: ${r.total - r.failed}/${r.total} ok` : "Hasn't run yet"}
              {r.lastError && <span className="block text-xs text-warn">{r.lastError}</span>}
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => refreshAll.mutate()} disabled={r.running || refreshAll.isPending}>
            <RefreshCw className={cx("size-4", r.running && "animate-spin")} /> Refresh all now
          </button>
        </div>
        <div className="mt-4 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
          <p className="flex items-center gap-2"><CalendarClock className="size-4 text-muted" /> Uptime {duration(d.system.uptimeSec * 1000)}</p>
          <p className="text-muted">Memory {d.system.memoryMb} MB</p>
          <p className="text-muted">Database {(d.system.dbBytes / 1048576).toFixed(1)} MB</p>
          <p className={cx(d.accounts.syncErrors ? "text-warn" : "text-muted")}>
            <Link to="/admin/accounts?status=error" className="hover:underline">{d.accounts.syncErrors} sync errors</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
