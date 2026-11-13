import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Loader2, X } from "lucide-react";
import { api } from "../lib/api";
import { ROLE_LABEL, ROLE_STYLE } from "../lib/format";
import type { Role } from "../lib/types";

export const cx = (...c: (string | number | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Spinner({ className = "size-5" }: { className?: string }) {
  return <Loader2 className={cx("animate-spin text-sakura", className)} />;
}

export function PageLoader() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Spinner className="size-8" />
    </div>
  );
}

export function Card({ className, children, hover }: { className?: string; children: ReactNode; hover?: boolean }) {
  return <div className={cx("glass p-5 sm:p-6", hover && "glass-hover", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, kicker }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; kicker?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        {kicker && <p className="mb-1 text-xs font-semibold tracking-[0.25em] text-sakura/80 uppercase">{kicker}</p>}
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="mb-2 text-sakura/70">{icon}</div>}
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", ROLE_STYLE[role])}>{ROLE_LABEL[role]}</span>;
}

// Users whose avatar we already asked the server to refresh this page load (avoid loops).
const avatarRefreshTried = new Set<number>();

export function Avatar({ src, name, userId, size = "size-10", className }: { src?: string | null; name: string; userId?: number; size?: string; className?: string }) {
  const [override, setOverride] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const current = override ?? src;
  useEffect(() => {
    setOverride(null);
    setBroken(false);
  }, [src]);
  const onError = () => {
    // Discord avatar URLs die when the user changes their picture; ask the server for the new one once.
    if (userId && !avatarRefreshTried.has(userId) && current?.includes("discordapp")) {
      avatarRefreshTried.add(userId);
      api
        .post<{ avatarUrl: string | null }>(`/api/users/${userId}/avatar`)
        .then((r) => (r.avatarUrl && r.avatarUrl !== current ? setOverride(r.avatarUrl) : setBroken(true)))
        .catch(() => setBroken(true));
      return;
    }
    setBroken(true);
  };
  if (!current || broken) {
    return (
      <div className={cx(size, "grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-sakura/40 to-sky/40 font-display font-bold text-ink", className)}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return <img src={current} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onError} className={cx(size, "shrink-0 rounded-full object-cover", className)} />;
}

export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-2 overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <div className="h-full rounded-full bg-gradient-to-r from-sakura to-sky transition-[width] duration-700" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-gradient-to-r from-sakura to-sky" : "bg-white/10")}
      >
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-sm text-muted">
        Page <b className="text-text">{page}</b> of {pages}
      </span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4 animate-fade" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={cx(
          "glass relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none bg-panel/95 outline-none animate-pop sm:rounded-2xl",
          wide ? "sm:max-w-4xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-text" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-night/80 py-1.5 pr-1.5 pl-3.5">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{shown ? value : "•".repeat(Math.min(value.length, 14))}</code>
        {secret && (
          <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide" : "Show"}>
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
        <button type="button" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-text" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

export function Stat({ label, value, icon, hint }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="glass flex items-center gap-4 p-4">
      {icon && <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sakura/15 to-sky/15 text-sakura">{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
        <p className="font-display text-2xl font-bold">{value}</p>
        {hint && <p className="truncate text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------- toasts --------------------------------- */

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "glass pointer-events-auto flex max-w-md items-center gap-2.5 bg-panel/95 px-4 py-3 text-sm animate-pop",
              t.kind === "error" && "border-bad/40",
              t.kind === "ok" && "border-ok/30",
            )}
          >
            <span className={cx("size-2 shrink-0 rounded-full", t.kind === "error" ? "bg-bad" : t.kind === "ok" ? "bg-ok" : "bg-sky")} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ConfirmButton({
  onConfirm, children, className, confirmText = "Are you sure?", disabled,
}: { onConfirm: () => void; children: ReactNode; className?: string; confirmText?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}
