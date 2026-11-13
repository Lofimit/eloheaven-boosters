import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, qs } from "../../lib/api";
import { actionLabel, fmtDateTime } from "../../lib/format";
import type { ActivityItem, Paged } from "../../lib/types";
import { cx, Empty, Pagination, Spinner } from "../../components/ui";

const FILTERS = [
  ["", "Everything"],
  ["account.", "Account use"],
  ["auth.", "Sign-ins"],
  ["admin.", "Staff actions"],
  ["submission.", "Submissions"],
] as const;

export default function ActivityLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const res = useQuery({
    queryKey: ["admin", "activity", action, page],
    queryFn: () => api.get<Paged<ActivityItem>>(`/api/admin/activity${qs({ action, page })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([v, l]) => (
          <button key={v} className={cx("btn btn-ghost btn-sm", action === v && "border-sakura/40 text-sakura")} onClick={() => { setAction(v); setPage(1); }}>{l}</button>
        ))}
      </div>
      <div className="glass overflow-x-auto">
        {!res.data?.items.length ? (
          res.isLoading ? <div className="grid place-items-center py-16"><Spinner /></div> : <Empty title="No activity" />
        ) : (
          <table className={cx("w-full text-left text-sm", res.isPlaceholderData && "opacity-60")}>
            <thead className="border-b border-line text-xs text-muted uppercase">
              <tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">What</th><th className="p-3">Account</th><th className="p-3">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {res.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="p-3 text-xs whitespace-nowrap text-muted">{fmtDateTime(a.createdAt)}</td>
                  <td className="p-3">{a.userId ? <Link className="hover:text-sakura" to={`/u/${a.userId}`}>{a.username}</Link> : <span className="text-muted">system</span>}</td>
                  <td className="p-3">{actionLabel(a.action)}</td>
                  <td className="p-3">{a.accountId ? <Link className="hover:text-sakura" to={`/account/${a.accountId}`}>{a.riotId}</Link> : "—"}</td>
                  <td className="max-w-xs truncate p-3 font-mono text-xs text-muted" title={JSON.stringify(a.details)}>
                    {a.details && typeof a.details === "object" && Object.keys(a.details).length ? JSON.stringify(a.details) : ""} {a.ip && <span className="opacity-60">{a.ip}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {res.data && <Pagination page={page} total={res.data.total} pageSize={res.data.pageSize} onPage={setPage} />}
    </>
  );
}
