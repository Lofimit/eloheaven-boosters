import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, ChevronDown, CircleHelp, HandHeart, LayoutDashboard, LogOut, Menu, MessageCircle, Settings, Shield, Sparkles, UserRound, Users, X,
} from "lucide-react";
import { api } from "../lib/api";
import { useMe, useMeta } from "../lib/hooks";
import { Avatar, cx, PageLoader, RoleBadge } from "./ui";

const STAFF = ["owner", "admin", "moderator"];

/** Fixed anime wallpaper + gradient veil + drifting petals. */
export function Backdrop({ wallpaper }: { wallpaper?: string }) {
  const petals = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: `${(i * 73) % 100}%`,
        delay: `${-(i * 1.9) % 18}s`,
        duration: `${14 + ((i * 7) % 12)}s`,
        drift: `${((i % 5) - 2) * 60}px`,
        scale: 0.6 + ((i * 13) % 10) / 15,
      })),
    [],
  );
  const src = wallpaper || "/images/background.webp";
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("/images/background-tiny.webp")`, filter: "blur(20px)", transform: "scale(1.1)" }} />
      <div className="absolute inset-0 bg-cover bg-center transition-opacity duration-700" style={{ backgroundImage: `url("${src.replace(/"/g, "")}")` }} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(7_6_13_/_0.45),rgb(7_6_13_/_0.62)_45%,rgb(7_6_13_/_0.9))]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgb(244_170_255_/_0.12),transparent_40%),radial-gradient(circle_at_90%_20%,rgb(114_199_255_/_0.10),transparent_40%)]" />
      {petals.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration, ["--drift" as string]: p.drift, scale: String(p.scale) }}
        />
      ))}
    </div>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <img src="/images/logo.webp" alt="" className="size-9 drop-shadow-[0_0_12px_rgb(244_170_255_/_0.45)]" />
      <span className="font-display text-xl font-bold tracking-tight">
        Elo<span className="text-gradient">Heaven</span>
      </span>
    </span>
  );
}

function UserMenu() {
  const { data } = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const u = data?.user;
  if (!u) return null;
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    qc.clear();
    nav("/", { replace: true });
  };
  const item = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5";
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full border border-line bg-white/[0.03] py-1 pr-2.5 pl-1 hover:border-sakura/30" aria-expanded={open}>
        <Avatar src={u.avatarUrl} name={u.username} userId={u.id} size="size-8" />
        <ChevronDown className={cx("size-4 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="glass absolute right-0 mt-2 w-64 bg-panel/95 p-2 animate-pop">
          <div className="flex items-center gap-3 border-b border-line px-2 pt-1 pb-3">
            <Avatar src={u.avatarUrl} name={u.username} userId={u.id} size="size-11" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{u.username}</p>
              <RoleBadge role={u.role} />
            </div>
          </div>
          <div className="pt-2">
            <Link className={item} to={`/u/${u.id}`}><UserRound className="size-4 text-muted" /> My profile</Link>
            <Link className={item} to="/settings"><Settings className="size-4 text-muted" /> Settings</Link>
            <Link className={item} to="/lend"><HandHeart className="size-4 text-muted" /> Lend an account</Link>
            {STAFF.includes(u.role) && <Link className={item} to="/admin"><Shield className="size-4 text-sakura" /> Admin panel</Link>}
            {meta.data?.discordInvite && (
              <a className={item} href={meta.data.discordInvite} target="_blank" rel="noreferrer"><MessageCircle className="size-4 text-muted" /> Discord</a>
            )}
            <button className={cx(item, "w-full text-bad")} onClick={logout}><LogOut className="size-4" /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Nav() {
  const { data } = useMe();
  const [mobile, setMobile] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname]);
  const access = data?.access;
  const links = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ...(access?.booster ? [{ to: "/accounts/booster", label: "Booster pool", icon: Sparkles }] : []),
    { to: "/accounts/community", label: "Community", icon: Users },
    { to: "/users", label: "Members", icon: UserRound },
    { to: "/rules", label: "Rules", icon: BookOpen },
    { to: "/help", label: "Help", icon: CircleHelp },
  ];
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cx("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition", isActive ? "bg-white/[0.07] text-text" : "text-muted hover:text-text");
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ink/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Link to="/dashboard"><Logo /></Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkCls}>
              <l.icon className="size-4" /> {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <UserMenu />
          <button className="rounded-lg p-2 text-muted hover:bg-white/5 lg:hidden" onClick={() => setMobile((m) => !m)} aria-label="Menu">
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {mobile && (
        <nav className="border-t border-line px-4 py-3 lg:hidden animate-fade">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkCls}>
              <l.icon className="size-4" /> {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

/** Applies user preferences (wallpaper, compact, reduced motion) globally. */
function usePrefs() {
  const { data } = useMe();
  const prefs = data?.user?.prefs;
  useEffect(() => {
    document.documentElement.classList.toggle("compact", Boolean(prefs?.compact));
    document.documentElement.classList.toggle("reduce-motion", Boolean(prefs?.reduceMotion));
  }, [prefs?.compact, prefs?.reduceMotion]);
  return prefs;
}

export function AppLayout() {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  const prefs = usePrefs();
  if (isLoading) return <><Backdrop /><PageLoader /></>;
  if (!data?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (data.user.banned) return <Navigate to="/login?error=Your%20account%20is%20banned" replace />;
  return (
    <>
      <Backdrop wallpaper={prefs?.wallpaper} />
      <Nav />
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

export function Footer() {
  return (
    <footer className="px-4 pb-8 text-center text-xs text-muted/70">
      <a href="https://discord.gg/kingsz" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-sakura">
        <MessageCircle className="size-3.5" /> discord.gg/kingsz
      </a>
    </footer>
  );
}

export function RequireStaff({ children }: { children: React.ReactNode }) {
  const { data } = useMe();
  if (!data?.user || !STAFF.includes(data.user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
