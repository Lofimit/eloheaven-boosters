import type { ReactNode } from "react";
import { Ban, Bug, Coins, Gamepad2, HandHeart, KeyRound, Medal, MessageCircle, Shield, Timer, UserLock, Users } from "lucide-react";
import { useMeta, useTitle } from "../lib/hooks";
import { PageHeader } from "../components/ui";

interface Item {
  icon: ReactNode;
  title: string;
  text: string;
}

function Grid({ items }: { items: Item[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map((it, i) => (
        <div key={it.title} className="glass glass-hover p-5 animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="mb-3 grid size-11 place-items-center rounded-xl bg-gradient-to-br from-sakura/15 to-sky/15 text-sakura">{it.icon}</div>
          <h3 className="font-bold">{it.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{it.text}</p>
        </div>
      ))}
    </div>
  );
}

export function Rules() {
  useTitle("Rules");
  const meta = useMeta();
  return (
    <>
      <PageHeader kicker="Play fair" title="Community rules" subtitle="Keep EloHeaven safe and fun for everyone. Breaking these can get you banned." />
      <Grid
        items={[
          { icon: <Shield className="size-5" />, title: "Follow Riot's rules", text: "No cheating, scripting or toxicity. Never go AFK. Treat every player with respect." },
          { icon: <Timer className="size-5" />, title: "Release when you're done", text: "Press Release as soon as you stop playing. Leases auto-expire (8 hours at most), but don't sit on an account you aren't using." },
          { icon: <Coins className="size-5" />, title: "Don't spend RP", text: "Never spend RP or skin shards. You may use BE to unlock champions and disenchant champion shards." },
          { icon: <UserLock className="size-5" />, title: "Keep logins private", text: "Never save credentials or share them. Logins can be rotated at any time." },
          { icon: <Users className="size-5" />, title: "Friends & chat", text: "You can add friends but don't remove existing ones, and don't chat with the owner's friends." },
          { icon: <Ban className="size-5" />, title: "High-elo accounts", text: "Above Emerald II, play seriously and try to win every game. Trolling there means an instant ban." },
        ]}
      />
      <p className="mt-10 text-center text-sm text-muted">
        Questions? Ask the staff on{" "}
        <a className="text-sakura hover:underline" href={meta.data?.discordInvite} target="_blank" rel="noreferrer">Discord</a>.
      </p>
    </>
  );
}

export function Help() {
  useTitle("Help");
  const meta = useMeta();
  return (
    <>
      <PageHeader kicker="Support" title="Help & FAQ" subtitle="Quick answers to the usual questions." />
      <Grid
        items={[
          { icon: <Gamepad2 className="size-5" />, title: "How do I play?", text: "Open an account, press “Use this account”, then “Show login”. When you're finished, press Release." },
          { icon: <Timer className="size-5" />, title: "Why was I released?", text: "Leases expire after a few hours to keep accounts moving. If you're in a game when it runs out, it waits for the game to end. No one can hold an account for more than 8 hours in a row." },
          { icon: <MessageCircle className="size-5" />, title: "Account in use?", text: "You can see who has it. Politely ask them on Discord if they're done. Never demand." },
          { icon: <Medal className="size-5" />, title: "Raising trust", text: "Follow the rules, keep a decent winrate, release accounts promptly and help others. Staff adjust trust by hand." },
          { icon: <KeyRound className="size-5" />, title: "Login not working?", text: "Wait 10 minutes and try again; Riot sometimes rate-limits logins. Still broken? Tell staff which account." },
          { icon: <HandHeart className="size-5" />, title: "Lending accounts", text: "Use “Lend an account” in your menu. Staff verify it before it goes live and you'll see it on your profile." },
          { icon: <Bug className="size-5" />, title: "Found a bug?", text: "Send a screenshot and the steps to reproduce it to staff on Discord. Thank you!" },
        ]}
      />
      <p className="mt-10 text-center text-sm text-muted">
        Still stuck? <a className="text-sakura hover:underline" href={meta.data?.discordInvite} target="_blank" rel="noreferrer">Join our Discord</a>.
      </p>
    </>
  );
}
