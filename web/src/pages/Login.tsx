import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Backdrop, Logo } from "../components/Layout";
import { cx, PageLoader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useMe, useMeta, useTitle } from "../lib/hooks";
import { DiscordGlyph } from "./Landing";

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(params.get("mode") === "register" ? "register" : "login");
  useTitle(mode === "login" ? "Sign in" : "Create account");
  const me = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (me.isLoading) return <><Backdrop /><PageLoader /></>;
  if (me.data?.user) return <Navigate to={safeNext} replace />;

  const canRegister = meta.data?.passwordRegistration;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(mode === "login" ? "/api/auth/login" : "/api/auth/register", { username, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav(safeNext, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Backdrop />
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <Link to="/" className="mb-8 animate-fade-up"><Logo /></Link>
        <div className="glass w-full max-w-sm p-6 animate-pop sm:p-7">
          <h1 className="text-2xl font-bold">{mode === "login" ? "Welcome back" : "Join EloHeaven"}</h1>
          <p className="mt-1 text-sm text-muted">{mode === "login" ? "Sign in to continue." : "It only takes a moment."}</p>

          {meta.data?.discordLogin && (
            <>
              <a href="/api/auth/discord" className="btn mt-6 w-full bg-[#5865F2] py-3 text-white hover:bg-[#4752c4]">
                <DiscordGlyph /> Continue with Discord
              </a>
              <div className="my-5 flex items-center gap-3 text-xs text-muted">
                <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          {mode === "register" && !canRegister ? (
            <p className="mt-6 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">Registration with a password is closed. Use Discord to join.</p>
          ) : (
            <form onSubmit={submit} className={cx("space-y-4", !meta.data?.discordLogin && "mt-6")}>
              <div>
                <label className="label" htmlFor="u">Username</label>
                <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={24} />
              </div>
              <div>
                <label className="label" htmlFor="p">Password</label>
                <input
                  id="p" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required
                  minLength={mode === "register" ? 8 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>
              {error && <p className="rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
              <button className="btn btn-primary w-full py-3" disabled={busy}>
                {busy && <Spinner className="size-4 text-ink" />} {mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
          )}

          {(canRegister || mode === "register") && (
            <p className="mt-5 text-center text-sm text-muted">
              {mode === "login" ? "New here? " : "Already have an account? "}
              <button className="font-semibold text-sakura hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
