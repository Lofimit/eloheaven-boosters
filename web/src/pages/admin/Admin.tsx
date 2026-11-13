import { NavLink, Route, Routes } from "react-router";
import { Activity, Gauge, Inbox, Settings2, Shield, Swords, Users } from "lucide-react";
import { useMe, useTitle } from "../../lib/hooks";
import { cx, PageHeader } from "../../components/ui";
import Overview from "./Overview";
import AccountsAdmin from "./AccountsAdmin";
import Submissions from "./Submissions";
import UsersAdmin from "./UsersAdmin";
import ActivityLog from "./ActivityLog";
import SettingsAdmin from "./SettingsAdmin";

export default function Admin() {
  useTitle("Admin");
  const { data } = useMe();
  const isAdmin = data?.user?.role === "owner" || data?.user?.role === "admin";
  const tabs = [
    { to: "/admin", label: "Overview", icon: Gauge, end: true },
    { to: "/admin/accounts", label: "Accounts", icon: Swords },
    { to: "/admin/submissions", label: "Submissions", icon: Inbox },
    { to: "/admin/users", label: "Users", icon: Users },
    { to: "/admin/activity", label: "Activity", icon: Activity },
    ...(isAdmin ? [{ to: "/admin/settings", label: "Settings", icon: Settings2 }] : []),
  ];
  return (
    <>
      <PageHeader kicker="Staff" title={<span className="flex items-center gap-3"><Shield className="size-8 text-sakura" /> Admin panel</span>} />
      <nav className="glass mb-6 flex gap-1 overflow-x-auto p-1.5">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cx("flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition", isActive ? "bg-gradient-to-r from-sakura/20 to-sky/15 text-text" : "text-muted hover:bg-white/5 hover:text-text")
            }
          >
            <t.icon className="size-4" /> {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="accounts" element={<AccountsAdmin />} />
        <Route path="submissions" element={<Submissions />} />
        <Route path="users" element={<UsersAdmin />} />
        <Route path="activity" element={<ActivityLog />} />
        {isAdmin && <Route path="settings" element={<SettingsAdmin />} />}
      </Routes>
    </>
  );
}
