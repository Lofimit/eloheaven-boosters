import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, X } from "lucide-react";
import { api, ApiError, qs } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import type { Paged, Pool } from "../../lib/types";
import { CopyField, cx, Empty, Modal, Pagination, Spinner, useToast } from "../../components/ui";

interface Sub {
  id: number;
  server: string;
  riotId: string | null;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  accountId: number | null;
  createdAt: number;
  reviewedAt: number | null;
  userId: number;
  username: string;
  userTrust: number;
  reviewer: string | null;
}

export default function Submissions() {
  const [status, setStatus] = useState<Sub["status"]>("pending");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Sub | null>(null);
  const res = useQuery({ queryKey: ["admin", "submissions", status, page], queryFn: () => api.get<Paged<Sub>>(`/api/admin/submissions${qs({ status, page })}`) });

  return (
    <>
      <div className="mb-4 flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button key={s} className={cx("btn btn-ghost btn-sm capitalize", status === s && "border-sakura/40 text-sakura")} onClick={() => { setStatus(s); setPage(1); }}>{s}</button>
        ))}
      </div>
      <div className="glass">
        {res.isLoading ? (
          <div className="grid place-items-center py-16"><Spinner /></div>
        ) : !res.data?.items.length ? (
          <Empty title={`No ${status} submissions`} />
        ) : (
          <ul className="divide-y divide-line">
            {res.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.riotId ?? <span className="text-muted">No Riot ID given</span>} <span className="chip ml-1">{s.server.toUpperCase()}</span></p>
                  <p className="text-xs text-muted">
                    by <Link className="text-text hover:text-sakura" to={`/u/${s.userId}`}>{s.username}</Link> ({s.userTrust}% trust) · {timeAgo(s.createdAt)}
                    {s.reviewer && <> · reviewed by {s.reviewer}</>}
                    {s.accountId && <> · <Link className="text-sakura hover:underline" to={`/account/${s.accountId}`}>account #{s.accountId}</Link></>}
                  </p>
                  {s.note && <p className="mt-1 text-sm text-muted italic">“{s.note}”</p>}
                  {s.reviewNote && <p className="mt-1 text-xs text-bad">Reason: {s.reviewNote}</p>}
                </div>
                {s.status === "pending" && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(s)}><Eye className="size-4" /> Review</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {res.data && <Pagination page={page} total={res.data.total} pageSize={res.data.pageSize} onPage={setPage} />}
      {open && <Review s={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Review({ s, onClose }: { s: Sub; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [riotId, setRiotId] = useState(s.riotId ?? "");
  const [pool, setPool] = useState<Pool>("community");
  const [trust, setTrust] = useState(0);
  const [note, setNote] = useState("");
  const secrets = useQuery({ queryKey: ["admin", "subsecrets", s.id], queryFn: () => api.get<{ login: string; password: string }>(`/api/admin/submissions/${s.id}/secrets`), gcTime: 0 });
  const done = (m: string) => {
    toast("ok", m);
    qc.invalidateQueries({ queryKey: ["admin"] });
    onClose();
  };
  const err = (e: unknown) => toast("error", e instanceof ApiError ? e.message : "Failed");
  const approve = useMutation({ mutationFn: () => api.post(`/api/admin/submissions/${s.id}/approve`, { riotId, pool, trustRequired: trust }), onSuccess: () => done("Approved, account is live"), onError: err });
  const reject = useMutation({ mutationFn: () => api.post(`/api/admin/submissions/${s.id}/reject`, { note }), onSuccess: () => done("Rejected"), onError: err });

  return (
    <Modal open onClose={onClose} title={`Submission #${s.id}`}>
      <div className="space-y-4">
        {secrets.data ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyField label="Login" value={secrets.data.login} />
            <CopyField label="Password" value={secrets.data.password} secret />
          </div>
        ) : <Spinner />}
        <p className="text-xs text-muted">Log in once to check it works, is email-verified and can play ranked before approving.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="label">Riot ID</label>
            <input className="input" placeholder="Name#TAG" value={riotId} onChange={(e) => setRiotId(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Pool</label>
            <select className="input" value={pool} onChange={(e) => setPool(e.target.value as Pool)}><option value="community">Community</option><option value="booster">Booster</option></select>
          </div>
          <div>
            <label className="label">Trust %</label>
            <input className="input" type="number" min={0} max={100} value={trust} onChange={(e) => setTrust(Number(e.target.value))} />
          </div>
        </div>
        <button className="btn btn-ok w-full" disabled={!riotId.includes("#") || approve.isPending} onClick={() => approve.mutate()}><Check className="size-4" /> Approve</button>
        <div className="border-t border-line pt-4">
          <label className="label">Rejection reason (shown to the user)</label>
          <div className="flex gap-2">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. not email verified" />
            <button className="btn btn-danger shrink-0" disabled={reject.isPending} onClick={() => reject.mutate()}><X className="size-4" /> Reject</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
