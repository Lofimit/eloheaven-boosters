import { Link, Navigate } from "react-router";
import { ArrowRight, Clock, Lock, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import { Backdrop, Footer, Logo } from "../components/Layout";
import { useMe, useMeta, useTitle } from "../lib/hooks";
import { PageLoader } from "../components/ui";

const FEATURES = [
  { icon: Trophy, title: "Live ranks", text: "Solo/Duo and Flex ranks synced from Riot's official API, every hour." },
  { icon: Clock, title: "Fair sharing", text: "Claim an account, play, release it. Leases expire on their own so nothing stays locked." },
  { icon: Lock, title: "Encrypted logins", text: "Credentials are encrypted at rest and only shown to whoever holds the account." },
  { icon: ShieldCheck, title: "Trust system", text: "Play fair to raise your trust rate and unlock higher-elo accounts." },
];

export default function Landing() {
  useTitle("");
  const me = useMe();
  const meta = useMeta();
  if (me.isLoading) return <><Backdrop /><PageLoader /></>;
  if (me.data?.user) return <Navigate to="/dashboard" replace />;

  return (
    <>
      <Backdrop />
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4">
        <Logo />
        <Link to="/login" className="btn btn-ghost">Sign in</Link>
      </header>
      <main className="mx-auto max-w-6xl px-4">
        <section className="flex min-h-[68dvh] flex-col items-center justify-center py-16 text-center">
          <p className="chip mb-6 border-sakura/30 text-sakura animate-fade-up">
            <Sparkles className="size-3.5" /> League of Legends account community
          </p>
          <h1 className="max-w-3xl text-5xl leading-[1.05] font-bold sm:text-7xl animate-fade-up [animation-delay:80ms]">
            Climb together in <span className="text-gradient">Heaven</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted animate-fade-up [animation-delay:160ms]">
            Shared accounts on every server, live rank tracking, and a community that plays fair.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3 animate-fade-up [animation-delay:240ms]">
            {meta.data?.discordLogin && (
              <a href="/api/auth/discord" className="btn btn-primary px-6 py-3 text-base">
                <DiscordGlyph /> Continue with Discord
              </a>
            )}
            <Link to={meta.data?.passwordRegistration ? "/login?mode=register" : "/login"} className="btn btn-ghost px-6 py-3 text-base">
              {meta.data?.passwordRegistration ? "Create an account" : "Sign in"} <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="glass glass-hover p-5 animate-fade-up" style={{ animationDelay: `${300 + i * 70}ms` }}>
              <div className="mb-4 grid size-11 place-items-center rounded-xl bg-gradient-to-br from-sakura/20 to-sky/20 text-sakura">
                <f.icon className="size-5" />
              </div>
              <h3 className="font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}

export function DiscordGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
