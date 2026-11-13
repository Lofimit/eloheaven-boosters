import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, KeyRound, Save } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Card, Spinner, Toggle, useToast } from "../../components/ui";

interface S {
  siteName: string;
  announcement: string;
  discordInvite: string;
  allowPasswordRegistration: boolean;
  leaseHours: number;
  maxHoldHours: number;
  maxActivePerUser: number;
  rankRefreshMinutes: number;
  legacyTokenSync: boolean;
  defaultTrustRate: number;
  riotApiKey: string;
}

export default function SettingsAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get<{ settings: S; riotKeyFromEnv: boolean; riotKey: { ok: boolean; message: string; checkedAt: number } | null }>("/api/admin/settings"),
  });
  const [s, setS] = useState<S | null>(null);
  useEffect(() => {
    if (q.data && !s) setS(q.data.settings);
  }, [q.data, s]);
  const save = useMutation({
    mutationFn: () => api.put<{ settings: S }>("/api/admin/settings", s),
    onSuccess: (r) => {
      setS(r.settings);
      toast("ok", "Settings saved");
      qc.invalidateQueries({ queryKey: ["meta"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Failed"),
  });
  const [downloading, setDownloading] = useState(false);
  const backup = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error("Backup failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eloheaven-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  if (!s) return <div className="grid place-items-center py-16"><Spinner /></div>;
  const num = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });
  const key = q.data?.riotKey;

  return (
    <form className="grid gap-6 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Card>
        <h2 className="mb-4 font-bold">General</h2>
        <div className="space-y-4">
          <div>
            <label className="label">Announcement (shown on everyone's dashboard)</label>
            <textarea className="input min-h-24" maxLength={1000} value={s.announcement} onChange={(e) => setS({ ...s, announcement: e.target.value })} placeholder="Leave empty to hide" />
          </div>
          <div>
            <label className="label">Discord invite link</label>
            <input className="input" value={s.discordInvite} onChange={(e) => setS({ ...s, discordInvite: e.target.value })} />
          </div>
          <Toggle label="Allow username/password sign-ups" hint="Discord login always works if configured" checked={s.allowPasswordRegistration} onChange={(v) => setS({ ...s, allowPasswordRegistration: v })} />
          <div>
            <label className="label">Default trust for new users (%)</label>
            <input className="input" type="number" min={0} max={100} value={s.defaultTrustRate} onChange={num("defaultTrustRate")} />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">Account sharing</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Lease length (hours)</label>
              <input className="input" type="number" min={1} max={48} value={s.leaseHours} onChange={num("leaseHours")} />
            </div>
            <div>
              <label className="label">Accounts per user</label>
              <input className="input" type="number" min={1} max={10} value={s.maxActivePerUser} onChange={num("maxActivePerUser")} />
            </div>
          </div>
          <div>
            <label className="label">Hard limit (hours)</label>
            <input className="input" type="number" min={1} max={72} value={s.maxHoldHours} onChange={num("maxHoldHours")} />
          </div>
          <p className="text-xs text-muted">
            Leases auto-release when they expire. If the account is in a game at that moment, it waits 20 minutes and checks again.
            After the hard limit the account is always released, even mid-game or if the user pressed Extend.
          </p>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 flex items-center gap-2 font-bold"><KeyRound className="size-4 text-sakura" /> Riot API</h2>
        <div className="space-y-4">
          <div>
            <label className="label">API key</label>
            <input
              className="input font-mono"
              value={s.riotApiKey}
              onChange={(e) => setS({ ...s, riotApiKey: e.target.value })}
              placeholder={q.data?.riotKeyFromEnv ? "Using RIOT_API_KEY from the environment" : "RGAPI-…"}
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs text-muted">
              Development keys expire every 24 hours. Apply for a free personal key at developer.riotgames.com so you don't have to keep replacing it.
            </p>
            {key && <p className={`mt-1 text-xs ${key.ok ? "text-ok" : "text-warn"}`}>Status: {key.message} ({timeAgo(key.checkedAt)})</p>}
          </div>
          <div>
            <label className="label">Rank refresh interval (minutes)</label>
            <input className="input" type="number" min={15} max={1440} value={s.rankRefreshMinutes} onChange={num("rankRefreshMinutes")} />
          </div>
          <Toggle label="Try legacy client tokens" hint="Riot deprecated these; failures are marked and skipped afterwards" checked={s.legacyTokenSync} onChange={(v) => setS({ ...s, legacyTokenSync: v })} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 flex items-center gap-2 font-bold"><Database className="size-4 text-sakura" /> Backup</h2>
        <p className="mb-4 text-sm text-muted">Download a consistent snapshot of the whole database. Credentials stay encrypted and need the same APP_SECRET to read.</p>
        <button type="button" className="btn btn-ghost" onClick={backup} disabled={downloading}>
          {downloading ? <Spinner className="size-4" /> : <Download className="size-4" />} Download backup
        </button>
      </Card>

      <div className="lg:col-span-2">
        <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? <Spinner className="size-4 text-ink" /> : <Save className="size-4" />} Save settings</button>
      </div>
    </form>
  );
}
