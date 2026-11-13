import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, KeyRound, LogOut, Play, RefreshCw, TimerReset } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { duration } from "../lib/format";
import { useNow } from "../lib/hooks";
import type { Account } from "../lib/types";
import { ConfirmButton, CopyField, cx, Modal, Spinner, useToast } from "./ui";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["account"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["mine"] });
  };
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

export function CredentialsModal({ accountId, open, onClose }: { accountId: number; open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["credentials", accountId],
    queryFn: () => api.get<{ login: string; password: string }>(`/api/accounts/${accountId}/credentials`),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <Modal open={open} onClose={onClose} title="Account login">
      {q.isLoading ? (
        <div className="grid place-items-center py-8"><Spinner /></div>
      ) : q.error ? (
        <p className="text-bad">{errMsg(q.error)}</p>
      ) : q.data ? (
        <div className="space-y-4">
          <CopyField label="Username" value={q.data.login} />
          <CopyField label="Password" value={q.data.password} secret />
          <p className="rounded-xl border border-line bg-white/[0.03] p-3 text-xs text-muted">
            Don't save these anywhere or share them. Release the account as soon as you're done so others can play.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

/** Claim / login / extend / release controls for one account. */
export function AccountActions({ a, compact }: { a: Account; compact?: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [showCreds, setShowCreds] = useState(false);
  const now = useNow(30_000);

  const claim = useMutation({
    mutationFn: () => api.post(`/api/accounts/${a.id}/claim`),
    onSuccess: () => {
      toast("ok", "Account claimed. Have fun!");
      invalidate();
      setShowCreds(true);
    },
    onError: (e) => toast("error", errMsg(e)),
  });
  const release = useMutation({
    mutationFn: () => api.post(`/api/accounts/${a.id}/release`),
    onSuccess: () => {
      toast("ok", "Account released. Thanks for sharing!");
      invalidate();
    },
    onError: (e) => toast("error", errMsg(e)),
  });
  const extend = useMutation({
    mutationFn: () => api.post(`/api/accounts/${a.id}/extend`),
    onSuccess: () => {
      toast("ok", "Lease extended");
      invalidate();
    },
    onError: (e) => toast("error", errMsg(e)),
  });
  const refresh = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/api/accounts/${a.id}/refresh`),
    onSuccess: (r) => {
      toast(r.ok ? "ok" : "error", r.message);
      invalidate();
    },
    onError: (e) => toast("error", errMsg(e)),
  });

  if (a.inUseByMe) {
    const left = a.leaseExpiresAt ? a.leaseExpiresAt - now : null;
    return (
      <div className={cx("flex flex-wrap items-center gap-2", compact && "text-sm")}>
        <button className="btn btn-primary" onClick={() => setShowCreds(true)}>
          <KeyRound className="size-4" /> Show login
        </button>
        <button className="btn btn-ghost" onClick={() => extend.mutate()} disabled={extend.isPending} title="Reset the lease timer">
          <TimerReset className="size-4" /> Extend
        </button>
        {!compact && (
          <button className="btn btn-ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending} title="Refresh rank from Riot">
            <RefreshCw className={cx("size-4", refresh.isPending && "animate-spin")} /> Refresh
          </button>
        )}
        <ConfirmButton className="btn btn-danger" onConfirm={() => release.mutate()} confirmText="Click to confirm" disabled={release.isPending}>
          <LogOut className="size-4" /> Release
        </ConfirmButton>
        {left !== null && (
          <span className={cx("flex items-center gap-1.5 text-xs", left < 15 * 60_000 ? "text-warn" : "text-muted")}>
            <Clock className="size-3.5" /> {left > 0 ? `auto-release in ${duration(left)}` : "releasing soon"}
            {a.inGame && " · paused while in game"}
          </span>
        )}
        <CredentialsModal accountId={a.id} open={showCreds} onClose={() => setShowCreds(false)} />
      </div>
    );
  }

  const disabled = a.banned || a.inUse || a.locked;
  const reason = a.banned ? "This account is banned" : a.inUse ? `In use by ${a.inUseBy?.username}` : a.locked ? `Needs ${a.trustRequired}% trust` : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn btn-primary px-6" disabled={disabled || claim.isPending} onClick={() => claim.mutate()}>
        {claim.isPending ? <Spinner className="size-4 text-ink" /> : <Play className="size-4" />} Use this account
      </button>
      {reason && <span className="text-sm text-muted">{reason}</span>}
    </div>
  );
}
