import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, HandHeart, XCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useMeta, useTitle } from "../lib/hooks";
import { Card, cx, Empty, PageHeader, Spinner, useToast } from "../components/ui";

interface Submission {
  id: number;
  server: string;
  riotId: string | null;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  accountId: number | null;
  createdAt: number;
}

const empty = { login: "", password: "", server: "euw", riotId: "", note: "" };

export default function Lend() {
  useTitle("Lend an account");
  const meta = useMeta();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const mine = useQuery({ queryKey: ["submissions"], queryFn: () => api.get<{ items: Submission[] }>("/api/submissions/mine") });
  const submit = useMutation({
    mutationFn: () => api.post("/api/submissions", form),
    onSuccess: () => {
      toast("ok", "Thanks! Staff will review it soon.");
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["submissions"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Couldn't submit"),
  });
  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader kicker="Give back" title="Lend an account" subtitle="Share an account with the community. Staff check every submission before it goes live." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="login">Login username</label>
                <input id="login" className="input" required value={form.login} onChange={up("login")} autoComplete="off" />
              </div>
              <div>
                <label className="label" htmlFor="pw">Password</label>
                <input id="pw" type="password" className="input" required value={form.password} onChange={up("password")} autoComplete="new-password" />
              </div>
              <div>
                <label className="label" htmlFor="server">Server</label>
                <select id="server" className="input" value={form.server} onChange={up("server")}>
                  {meta.data?.servers.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="rid">Riot ID</label>
                <input id="rid" className="input" placeholder="Name#TAG" value={form.riotId} onChange={up("riotId")} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="note">Note for staff (optional)</label>
              <textarea id="note" className="input min-h-20" maxLength={300} value={form.note} onChange={up("note")} placeholder="Anything we should know?" />
            </div>
            <div className="rounded-xl border border-warn/25 bg-warn/5 p-3 text-xs text-warn/90">
              Only submit email-verified accounts that can play ranked. Don't submit restricted or banned accounts.
            </div>
            <button className="btn btn-primary w-full py-3" disabled={submit.isPending}>
              {submit.isPending ? <Spinner className="size-4 text-ink" /> : <HandHeart className="size-4" />} Submit for review
            </button>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">Your submissions</h2>
          {!mine.data?.items.length ? (
            <Empty title="Nothing submitted yet" />
          ) : (
            <ul className="space-y-2">
              {mine.data.items.map((s) => (
                <li key={s.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{s.riotId ?? "Account"} <span className="text-xs text-muted">{s.server.toUpperCase()}</span></span>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {timeAgo(s.createdAt)}
                    {s.accountId && <> · <Link className="text-sakura hover:underline" to={`/account/${s.accountId}`}>view account</Link></>}
                  </p>
                  {s.reviewNote && <p className="mt-1 text-xs text-bad">“{s.reviewNote}”</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function StatusChip({ status }: { status: Submission["status"] }) {
  const map = {
    pending: ["text-warn border-warn/30", Clock, "Pending"],
    approved: ["text-ok border-ok/30", CheckCircle2, "Approved"],
    rejected: ["text-bad border-bad/30", XCircle, "Rejected"],
  } as const;
  const [cls, Icon, label] = map[status];
  return <span className={cx("chip", cls)}><Icon className="size-3" /> {label}</span>;
}
