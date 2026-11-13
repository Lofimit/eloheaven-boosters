import { useEffect, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, LogOut, Search, Trash2 } from "lucide-react";
import { api, ApiError, qs } from "../../lib/api";
import { actionLabel, fmtDate, fmtDateTime, ROLE_LABEL, timeAgo } from "../../lib/format";
import { useDebounced, useMe } from "../../lib/hooks";
import type { Paged, Role, SelfUser } from "../../lib/types";
import { Avatar, ConfirmButton, cx, Empty, Modal, Pagination, RoleBadge, Spinner, Toggle, useToast } from "../../components/ui";

interface Row {
  id: number;
  username: string;
  avatarUrl: string | null;
  role: Role;
  trustRate: number;
  banned: number;
  discord: number;
  createdAt: number;
  lastSeenAt: number | null;
  lastIp: string | null;
  subscriptionEndsAt: number | null;
}

const ROLE_ORDER: Role[] = ["customer", "booster", "moderator", "admin", "owner"];

export default function UsersAdmin() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [flag, setFlag] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useDebounced(search);
  const res = useQuery({
    queryKey: ["admin", "users", q, role, flag, page],
    queryFn: () => api.get<Paged<Row>>(`/api/admin/users${qs({ q, role, page, subscribed: flag === "sub" ? "1" : "", banned: flag === "banned" ? "1" : "" })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="glass mb-4 flex flex-wrap gap-2 p-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Username, Discord ID or #id…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input w-auto" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role">
          <option value="">All roles</option>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select className="input w-auto" value={flag} onChange={(e) => { setFlag(e.target.value); setPage(1); }} aria-label="Filter">
          <option value="">Everyone</option><option value="sub">Subscribed</option><option value="banned">Banned</option>
        </select>
      </div>
      <div className="glass overflow-x-auto">
        {!res.data?.items.length ? (
          res.isLoading ? <div className="grid place-items-center py-16"><Spinner /></div> : <Empty title="No users" />
        ) : (
          <table className={cx("w-full text-left text-sm", res.isPlaceholderData && "opacity-60")}>
            <thead className="border-b border-line text-xs text-muted uppercase">
              <tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Trust</th><th className="p-3">Subscription</th><th className="p-3">Last seen</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {res.data.items.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => setOpen(u.id)}>
                  <td className="p-3">
                    <span className="flex items-center gap-2.5">
                      <Avatar src={u.avatarUrl} name={u.username} userId={u.id} size="size-8" />
                      <span className={cx("font-medium", u.banned && "text-bad line-through")}>{u.username}</span>
                      <span className="text-xs text-muted">#{u.id}</span>
                    </span>
                  </td>
                  <td className="p-3"><RoleBadge role={u.role} /></td>
                  <td className="p-3">{u.trustRate}%</td>
                  <td className="p-3 text-xs">{u.subscriptionEndsAt ? <span className="text-ok">until {fmtDate(u.subscriptionEndsAt)}</span> : <span className="text-muted">—</span>}</td>
                  <td className="p-3 text-xs text-muted">{timeAgo(u.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {res.data && <Pagination page={page} total={res.data.total} pageSize={res.data.pageSize} onPage={setPage} />}
      {open !== null && <UserEditor id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

interface Detail {
  user: SelfUser & { discordId: string | null; banReason: string | null; registerIp: string | null; lastIp: string | null };
  subscriptions: { id: number; startsAt: number; endsAt: number; note: string | null; createdBy: string | null }[];
  sessions: number;
  holding: { id: number; riotId: string; since: number }[];
  activity: { id: number; action: string; createdAt: number; riotId: string | null; accountId: number | null; ip: string | null }[];
}

function UserEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: me } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["admin", "user", id], queryFn: () => api.get<Detail>(`/api/admin/users/${id}`) });
  const [form, setForm] = useState<{ role: Role; trustRate: number; banned: boolean; banReason: string } | null>(null);
  const [days, setDays] = useState(30);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (d.data && !form) setForm({ role: d.data.user.role, trustRate: d.data.user.trustRate, banned: d.data.user.banned, banReason: d.data.user.banReason ?? "" });
  }, [d.data, form]);

  const myRole = me?.user?.role ?? "customer";
  const isAdmin = myRole === "owner" || myRole === "admin";
  const assignable = ROLE_ORDER.filter((r) => myRole === "owner" || ROLE_ORDER.indexOf(r) < ROLE_ORDER.indexOf(myRole));
  const err = (e: unknown) => toast("error", e instanceof ApiError ? e.message : "Failed");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "user", id] });
  };
  const save = useMutation({
    mutationFn: () => api.patch(`/api/admin/users/${id}`, { ...form, banReason: form?.banReason || null }),
    onSuccess: () => { toast("ok", "User updated"); refresh(); },
    onError: err,
  });
  const addSub = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/subscriptions`, { days, note }),
    onSuccess: () => { toast("ok", `Added ${days} days`); setNote(""); refresh(); },
    onError: err,
  });
  const delSub = useMutation({ mutationFn: (sid: number) => api.del(`/api/admin/subscriptions/${sid}`), onSuccess: refresh, onError: err });
  const logoutAll = useMutation({ mutationFn: () => api.post(`/api/admin/users/${id}/logout-all`), onSuccess: () => { toast("ok", "Signed out everywhere"); refresh(); }, onError: err });

  const u = d.data?.user;
  return (
    <Modal open onClose={onClose} title={u ? u.username : "User"} wide>
      {!d.data || !form || !u ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar src={u.avatarUrl} name={u.username} userId={u.id} size="size-14" />
              <div className="text-xs text-muted">
                <p>Joined {fmtDate(u.createdAt)} · seen {timeAgo(u.lastSeenAt)}</p>
                <p>Discord: {u.discordId ?? "not linked"} · password: {u.hasPassword ? "yes" : "no"}</p>
                <p>IP: {u.lastIp ?? "?"} (registered {u.registerIp ?? "?"}) · {d.data.sessions} sessions</p>
                <Link to={`/u/${u.id}`} className="text-sakura hover:underline">Public profile</Link>
              </div>
            </div>

            {isAdmin ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Role</label>
                    <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                      {(assignable.includes(form.role) ? assignable : [form.role, ...assignable]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Trust rate: {form.trustRate}%</label>
                    <input type="range" min={0} max={100} className="mt-3 w-full accent-[#f4aaff]" value={form.trustRate} onChange={(e) => setForm({ ...form, trustRate: Number(e.target.value) })} />
                  </div>
                </div>
                <Toggle label="Banned" hint="Signs them out and frees any account they hold" checked={form.banned} onChange={(v) => setForm({ ...form, banned: v })} />
                {form.banned && <input className="input" placeholder="Ban reason (shown to them)" value={form.banReason} onChange={(e) => setForm({ ...form, banReason: e.target.value })} />}
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
                  <ConfirmButton className="btn btn-ghost" confirmText="Sign out everywhere?" onConfirm={() => logoutAll.mutate()}><LogOut className="size-4" /> Sign out sessions</ConfirmButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Only admins can change roles, trust and bans.</p>
            )}

            {d.data.holding.length > 0 && (
              <div>
                <p className="label">Holding</p>
                {d.data.holding.map((h) => <Link key={h.id} to={`/account/${h.id}`} className="block text-sm hover:text-sakura">{h.riotId} · {timeAgo(h.since)}</Link>)}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <p className="label">Subscriptions</p>
              {d.data.subscriptions.length === 0 ? <p className="text-sm text-muted">None</p> : (
                <ul className="space-y-1.5 text-sm">
                  {d.data.subscriptions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                      <span>
                        {fmtDate(s.startsAt)} → <b className={s.endsAt > Date.now() ? "text-ok" : "text-muted"}>{fmtDate(s.endsAt)}</b>
                        {s.note && <span className="text-xs text-muted"> · {s.note}</span>}
                      </span>
                      {isAdmin && <button className="text-muted hover:text-bad" onClick={() => delSub.mutate(s.id)} aria-label="Remove"><Trash2 className="size-4" /></button>}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {[7, 14, 30, 60, 90, 365].map((n) => <option key={n} value={n}>+{n} days</option>)}
                  </select>
                  <input className="input min-w-0 flex-1" placeholder="Note (e.g. paid via…)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn btn-ok" onClick={() => addSub.mutate()} disabled={addSub.isPending}><CalendarPlus className="size-4" /> Add</button>
                </div>
              )}
            </div>
            <div>
              <p className="label">Recent activity</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {d.data.activity.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span>{actionLabel(a.action)} {a.riotId && <span className="text-muted">{a.riotId}</span>}</span>
                    <span className="shrink-0 text-muted" title={a.ip ?? undefined}>{fmtDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
