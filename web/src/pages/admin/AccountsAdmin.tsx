import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, ApiError, qs } from "../../lib/api";
import { rankLabel, tierColor, timeAgo } from "../../lib/format";
import { useDebounced, useMe, useMeta } from "../../lib/hooks";
import type { Account, Paged, Pool } from "../../lib/types";
import { ChampionPicker, StatusPill } from "../../components/league";
import { ConfirmButton, cx, Empty, Modal, Pagination, Spinner, Toggle, useToast } from "../../components/ui";

export default function AccountsAdmin() {
  const [sp, setSp] = useSearchParams();
  const meta = useMeta();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const q = useDebounced(search);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const f = { q, pool: sp.get("pool") ?? "", status: sp.get("status") ?? "", server: sp.get("server") ?? "", page: Number(sp.get("page") ?? 1) };
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    if (k !== "page") n.delete("page");
    setSp(n, { replace: true });
  };
  const res = useQuery({
    queryKey: ["admin", "accounts", f],
    queryFn: () => api.get<Paged<Account>>(`/api/admin/accounts${qs(f)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="glass mb-4 flex flex-wrap gap-2 p-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Riot ID, note or #id…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={f.pool} onChange={(e) => set("pool", e.target.value)} aria-label="Pool">
          <option value="">All pools</option><option value="booster">Booster</option><option value="community">Community</option>
        </select>
        <select className="input w-auto" value={f.server} onChange={(e) => set("server", e.target.value)} aria-label="Server">
          <option value="">All servers</option>
          {meta.data?.servers.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </select>
        <select className="input w-auto" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Any status</option><option value="available">Available</option><option value="in_use">In use</option>
          <option value="banned">Banned</option><option value="inactive">Hidden</option><option value="error">Sync error</option><option value="token_ok">Working token</option>
        </select>
        <button className="btn btn-primary" onClick={() => setEditing("new")}><Plus className="size-4" /> New account</button>
      </div>

      <div className="glass overflow-x-auto">
        {!res.data?.items.length ? (
          res.isLoading ? <div className="grid place-items-center py-16"><Spinner /></div> : <Empty title="No accounts" />
        ) : (
          <table className={cx("w-full text-left text-sm", res.isPlaceholderData && "opacity-60")}>
            <thead className="border-b border-line text-xs text-muted uppercase">
              <tr>
                <th className="p-3">#</th><th className="p-3">Riot ID</th><th className="p-3">Pool</th><th className="p-3">Solo</th>
                <th className="p-3">Trust</th><th className="p-3">Status</th><th className="p-3">Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {res.data.items.map((a) => (
                <tr key={a.id} className={cx("cursor-pointer hover:bg-white/[0.03]", !a.active && "opacity-50")} onClick={() => setEditing(a.id)}>
                  <td className="p-3 text-muted">{a.id}</td>
                  <td className="p-3 font-medium">{a.riotId} <span className="text-xs text-muted">{a.server.toUpperCase()}</span></td>
                  <td className="p-3 capitalize">{a.pool}</td>
                  <td className={cx("p-3", tierColor(a.solo.tier))}>{rankLabel(a.solo)}</td>
                  <td className="p-3">{a.trustRequired}%</td>
                  <td className="p-3 text-xs"><StatusPill a={a} /></td>
                  <td className="p-3 text-xs">
                    <span className={a.syncError ? "text-warn" : "text-muted"} title={a.syncError ?? undefined}>{a.syncError ? "error" : timeAgo(a.rankSyncedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {res.data && <Pagination page={f.page} total={res.data.total} pageSize={res.data.pageSize} onPage={(p) => set("page", String(p))} />}
      {editing !== null && <AccountEditor id={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

interface Form {
  pool: Pool;
  server: string;
  riotId: string;
  login: string;
  password: string;
  trustRequired: number;
  notes: string;
  active: boolean;
  banned: boolean;
  flashOnF: boolean;
  be: string;
  rp: string;
  refunds: string;
  champions: number[];
  refreshToken: string;
  ownerId: string;
}

const blank: Form = {
  pool: "booster", server: "euw", riotId: "", login: "", password: "", trustRequired: 0, notes: "", active: true, banned: false, flashOnF: false,
  be: "", rp: "", refunds: "", champions: [], refreshToken: "", ownerId: "",
};

function AccountEditor({ id, onClose }: { id: number | "new"; onClose: () => void }) {
  const isNew = id === "new";
  const meta = useMeta();
  const { data: me } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [loaded, setLoaded] = useState(isNew);

  const acc = useQuery({ queryKey: ["account", String(id)], queryFn: () => api.get<{ account: Account }>(`/api/accounts/${id}`), enabled: !isNew });
  const secrets = useQuery({
    queryKey: ["admin", "secrets", id],
    queryFn: () => api.get<{ login: string; password: string; refreshToken: string; champions: number[]; ownerId: number | null }>(`/api/admin/accounts/${id}/secrets`),
    enabled: !isNew,
    gcTime: 0,
  });
  useEffect(() => {
    if (isNew || !acc.data || !secrets.data || loaded) return;
    const a = acc.data.account;
    const s = secrets.data;
    setForm({
      pool: a.pool, server: a.server, riotId: a.riotId, login: s.login, password: s.password, trustRequired: a.trustRequired, notes: a.notes ?? "",
      active: a.active, banned: a.banned, flashOnF: a.flashOnF, be: a.be?.toString() ?? "", rp: a.rp?.toString() ?? "", refunds: a.refunds?.toString() ?? "",
      champions: s.champions, refreshToken: s.refreshToken, ownerId: s.ownerId?.toString() ?? "",
    });
    setLoaded(true);
  }, [acc.data, secrets.data, isNew, loaded]);

  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  const body = () => ({
    pool: form.pool, server: form.server, riotId: form.riotId.trim(), login: form.login, password: form.password, trustRequired: Number(form.trustRequired) || 0,
    notes: form.notes, active: form.active, banned: form.banned, flashOnF: form.flashOnF, be: n(form.be), rp: n(form.rp), refunds: n(form.refunds),
    champions: form.champions, refreshToken: form.refreshToken.trim(), ownerId: n(form.ownerId),
  });
  const done = (msg: string) => {
    toast("ok", msg);
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["account"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    onClose();
  };
  const err = (e: unknown) => toast("error", e instanceof ApiError ? e.message : "Failed");
  const save = useMutation({
    mutationFn: () => (isNew ? api.post("/api/admin/accounts", body()) : api.patch(`/api/admin/accounts/${id}`, body())),
    onSuccess: () => done(isNew ? "Account created, syncing rank…" : "Saved"),
    onError: err,
  });
  const del = useMutation({ mutationFn: () => api.del(`/api/admin/accounts/${id}`), onSuccess: () => done("Deleted"), onError: err });
  const sync = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/api/accounts/${id}/refresh`),
    onSuccess: (r) => {
      toast(r.ok ? "ok" : "error", r.message);
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["account", String(id)] });
    },
    onError: err,
  });

  const up = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const inp = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const a = acc.data?.account;
  const canDelete = me?.user?.role === "owner" || me?.user?.role === "admin";

  return (
    <Modal open onClose={onClose} title={isNew ? "New account" : `Edit #${id}`} wide>
      {!loaded ? (
        <div className="grid place-items-center py-16">{acc.error || secrets.error ? <p className="text-bad">Couldn't load account</p> : <Spinner />}</div>
      ) : (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {a && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-muted">
              <span>PUUID {a.hasPuuid ? "resolved" : "missing"}</span> · <span>rank synced {timeAgo(a.rankSyncedAt)}</span> ·
              <span>token: {a.tokenStatus}</span>
              {a.syncError && <span className="w-full text-warn">Error: {a.syncError}</span>}
              <Link to={`/account/${id}`} className="ml-auto text-sakura hover:underline">Open public page</Link>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Pool</label>
              <select className="input" value={form.pool} onChange={inp("pool")}><option value="booster">Booster</option><option value="community">Community</option></select>
            </div>
            <div>
              <label className="label">Server</label>
              <select className="input" value={form.server} onChange={inp("server")}>
                {meta.data?.servers.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Riot ID</label>
              <input className="input" required placeholder="Name#TAG" value={form.riotId} onChange={inp("riotId")} />
            </div>
            <div>
              <label className="label">Login</label>
              <input className="input" required value={form.login} onChange={inp("login")} autoComplete="off" />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input font-mono" required value={form.password} onChange={inp("password")} autoComplete="off" />
            </div>
            <div>
              <label className="label">Trust required (%)</label>
              <input className="input" type="number" min={0} max={100} value={form.trustRequired} onChange={(e) => up("trustRequired")(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Blue Essence</label>
              <input className="input" type="number" min={0} value={form.be} onChange={inp("be")} placeholder="unknown" />
            </div>
            <div>
              <label className="label">RP</label>
              <input className="input" type="number" min={0} value={form.rp} onChange={inp("rp")} placeholder="unknown" />
            </div>
            <div>
              <label className="label">Refunds</label>
              <input className="input" type="number" min={0} max={10} value={form.refunds} onChange={inp("refunds")} placeholder="unknown" />
            </div>
            <div>
              <label className="label">Owner user ID</label>
              <input className="input" type="number" min={1} value={form.ownerId} onChange={inp("ownerId")} placeholder="none" />
            </div>
          </div>

          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-3">
            <Toggle label="Visible" hint="Hidden accounts can't be claimed" checked={form.active} onChange={up("active")} />
            <Toggle label="Banned" checked={form.banned} onChange={up("banned")} />
            <Toggle label="Flash on F" checked={form.flashOnF} onChange={up("flashOnF")} />
          </div>

          <div>
            <label className="label">Staff notes</label>
            <textarea className="input min-h-16" value={form.notes} onChange={inp("notes")} />
          </div>

          <div>
            <span className="label">Owned champions ({form.champions.length})</span>
            <ChampionPicker value={form.champions} onChange={up("champions")} />
          </div>

          <details className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">Legacy refresh token (optional)</summary>
            <p className="mt-2 text-xs text-muted">Riot deprecated these, so most will fail. If one works, BE/RP/champions/bans sync automatically. Leave empty otherwise.</p>
            <textarea className="input mt-2 min-h-16 font-mono text-xs" value={form.refreshToken} onChange={inp("refreshToken")} />
          </details>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button className="btn btn-primary" disabled={save.isPending}>{save.isPending && <Spinner className="size-4 text-ink" />} {isNew ? "Create account" : "Save changes"}</button>
            {!isNew && (
              <button type="button" className="btn btn-ghost" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw className={cx("size-4", sync.isPending && "animate-spin")} /> Sync from Riot
              </button>
            )}
            {!isNew && canDelete && (
              <ConfirmButton className="btn btn-danger ml-auto" confirmText="Delete permanently?" onConfirm={() => del.mutate()}>
                <Trash2 className="size-4" /> Delete
              </ConfirmButton>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
