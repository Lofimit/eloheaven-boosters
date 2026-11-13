import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, MonitorDown, Palette, Save, UserRound } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { fmtDate, GAME_ROLES } from "../lib/format";
import { useMe, useMeta, useTitle } from "../lib/hooks";
import type { SelfUser } from "../lib/types";
import { ChampionPicker } from "../components/league";
import { Card, CopyField, cx, PageHeader, Spinner, Toggle, useToast } from "../components/ui";
import { DiscordGlyph } from "./Landing";

export default function Settings() {
  useTitle("Settings");
  const { data } = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp] = useSearchParams();
  const u = data!.user!;
  const [form, setForm] = useState(() => ({
    username: u.username,
    bio: u.bio,
    mainRoles: u.mainRoles,
    mainChampions: u.mainChampions,
    prefs: { wallpaper: u.prefs.wallpaper ?? "", compact: Boolean(u.prefs.compact), reduceMotion: Boolean(u.prefs.reduceMotion) },
  }));

  useEffect(() => {
    if (sp.get("linked")) toast("ok", "Discord linked");
    if (sp.get("error")) toast("error", sp.get("error")!);
  }, [sp, toast]);

  const err = (e: unknown) => toast("error", e instanceof ApiError ? e.message : "Something went wrong");
  const save = useMutation({
    mutationFn: () => api.patch<{ user: SelfUser }>("/api/me", form),
    onSuccess: (r) => {
      qc.setQueryData(["me"], (old: object) => ({ ...old, user: r.user }));
      toast("ok", "Saved");
    },
    onError: err,
  });

  const toggleRole = (r: string) =>
    setForm((f) => ({ ...f, mainRoles: f.mainRoles.includes(r) ? f.mainRoles.filter((x) => x !== r) : [...f.mainRoles, r] }));

  return (
    <>
      <PageHeader
        kicker="Account"
        title="Settings"
        actions={
          <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Spinner className="size-4 text-ink" /> : <Save className="size-4" />} Save changes
          </button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><UserRound className="size-5 text-sakura" /> Profile</h2>
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="un">Username</label>
                <input id="un" className="input" value={form.username} maxLength={24} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="bio">Bio</label>
                <textarea id="bio" className="input min-h-24" maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Say something nice…" />
                <p className="mt-1 text-right text-xs text-muted">{form.bio.length}/300</p>
              </div>
              <div>
                <span className="label">Main roles</span>
                <div className="grid grid-cols-5 gap-2">
                  {GAME_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRole(r)}
                      className={cx("flex flex-col items-center gap-1 rounded-xl border p-2 transition", form.mainRoles.includes(r) ? "border-sakura/60 bg-sakura/10" : "border-line opacity-60 hover:opacity-100")}
                    >
                      <img src={`/images/roles/${r.toLowerCase()}.webp`} alt="" className="size-9" />
                      <span className="text-xs">{r}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="label">Main champions (up to 3)</span>
                <ChampionPicker value={form.mainChampions} onChange={(v) => setForm({ ...form, mainChampions: v })} max={3} />
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Palette className="size-5 text-sakura" /> Appearance</h2>
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="wp">Custom wallpaper URL</label>
                <input
                  id="wp"
                  className="input"
                  placeholder="https://… (leave empty for the default)"
                  value={form.prefs.wallpaper}
                  onChange={(e) => setForm({ ...form, prefs: { ...form.prefs, wallpaper: e.target.value } })}
                />
                {form.prefs.wallpaper && (
                  <button type="button" className="mt-2 text-xs text-muted hover:text-sakura" onClick={() => setForm({ ...form, prefs: { ...form.prefs, wallpaper: "" } })}>
                    Reset to default
                  </button>
                )}
              </div>
              <Toggle label="Compact mode" hint="Smaller text, fits more on screen" checked={form.prefs.compact} onChange={(v) => setForm({ ...form, prefs: { ...form.prefs, compact: v } })} />
              <Toggle label="Reduce motion" hint="Turn off petals and animations" checked={form.prefs.reduceMotion} onChange={(v) => setForm({ ...form, prefs: { ...form.prefs, reduceMotion: v } })} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <SecurityCard user={u} discordLogin={Boolean(meta.data?.discordLogin)} />
          <ClientCard user={u} subscriptionEndsAt={data?.subscriptionEndsAt ?? null} />
        </div>
      </div>
    </>
  );
}

function SecurityCard({ user, discordLogin }: { user: SelfUser; discordLogin: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const pw = useMutation({
    mutationFn: () => api.post("/api/me/password", { current, next }),
    onSuccess: () => {
      toast("ok", "Password updated. Other sessions were signed out.");
      setCurrent("");
      setNext("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Failed"),
  });
  const unlink = useMutation({
    mutationFn: () => api.post("/api/me/unlink-discord"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Failed"),
  });
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><KeyRound className="size-5 text-sakura" /> Security</h2>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); pw.mutate(); }}>
        {user.hasPassword && (
          <input type="password" className="input" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        )}
        <input type="password" className="input" placeholder={user.hasPassword ? "New password" : "Set a password (optional)"} autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        <button className="btn btn-ghost w-full" disabled={pw.isPending || next.length < 8}>{user.hasPassword ? "Change password" : "Set password"}</button>
      </form>
      {discordLogin && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-muted" /> Discord</p>
          {user.discordLinked ? (
            <div className="flex items-center justify-between gap-2">
              <span className="chip border-ok/30 text-ok">Linked</span>
              {user.hasPassword && <button className="text-xs text-muted hover:text-bad" onClick={() => unlink.mutate()}>Unlink</button>}
            </div>
          ) : (
            <a href="/api/auth/discord" className="btn w-full bg-[#5865F2] text-white hover:bg-[#4752c4]"><DiscordGlyph className="size-4" /> Link Discord</a>
          )}
        </div>
      )}
    </Card>
  );
}

function ClientCard({ user, subscriptionEndsAt }: { user: SelfUser; subscriptionEndsAt: number | null }) {
  const toast = useToast();
  const qc = useQueryClient();
  const regen = useMutation({
    mutationFn: () => api.post<{ clientKey: string }>("/api/me/client-key"),
    onSuccess: () => {
      toast("ok", "New key generated. Update it in the desktop client.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Failed"),
  });
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><MonitorDown className="size-5 text-sakura" /> Desktop client</h2>
      <p className="mb-4 text-sm text-muted">
        {subscriptionEndsAt ? <>Subscription active until <b className="text-text">{fmtDate(subscriptionEndsAt)}</b>.</> : "Requires an active subscription."}
      </p>
      {user.clientKey && <CopyField label="Client key" value={user.clientKey} secret />}
      {subscriptionEndsAt && (
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => regen.mutate()} disabled={regen.isPending}>
          {user.clientKey ? "Regenerate key" : "Generate key"}
        </button>
      )}
    </Card>
  );
}
