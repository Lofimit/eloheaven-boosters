import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api, qs } from "../lib/api";
import { ROLE_LABEL, timeAgo } from "../lib/format";
import { useDebounced, useTitle } from "../lib/hooks";
import type { Paged, PublicUser, Role } from "../lib/types";
import { Avatar, cx, Empty, PageHeader, Pagination, RoleBadge } from "../components/ui";

export default function Members() {
  useTitle("Members");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const res = useQuery({
    queryKey: ["users", q, role, page],
    queryFn: () => api.get<Paged<PublicUser>>(`/api/users${qs({ q, role, page })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader kicker="Community" title="Members" subtitle={res.data ? `${res.data.total} members` : undefined} />
      <div className="glass mb-6 flex flex-wrap gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search members…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input w-auto" value={role} onChange={(e) => { setRole(e.target.value as Role | ""); setPage(1); }} aria-label="Role">
          <option value="">All roles</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </div>
      {!res.data?.items.length && !res.isLoading ? (
        <div className="glass"><Empty title="No members found" /></div>
      ) : (
        <div className={cx("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", res.isPlaceholderData && "opacity-60")}>
          {res.data?.items.map((u, i) => (
            <Link key={u.id} to={`/u/${u.id}`} className="glass glass-hover flex items-center gap-3 p-4 animate-fade-up" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <Avatar src={u.avatarUrl} name={u.username} userId={u.id} size="size-12" />
              <div className="min-w-0 flex-1">
                <p className={cx("truncate font-semibold", u.banned && "line-through opacity-60")}>{u.username}</p>
                <p className="text-xs text-muted">seen {timeAgo(u.lastSeenAt)}</p>
              </div>
              <RoleBadge role={u.role} />
            </Link>
          ))}
        </div>
      )}
      {res.data && <Pagination page={page} total={res.data.total} pageSize={res.data.pageSize} onPage={setPage} />}
    </>
  );
}
