import { housekeeping, q } from "./db.js";
import { logActivity } from "./lib/activity.js";
import { getDDragon } from "./riot/ddragon.js";
import { refreshAll, refreshInGame, refreshStatus } from "./riot/sync.js";
import { getSettings, riotApiKey } from "./settings.js";

/**
 * Release leases that ran out. Accounts that are mid-game get 20 more minutes,
 * but anything held longer than maxHoldHours is always released (hard cap).
 */
export function expireLeases() {
  const now = Date.now();
  const hardCutoff = now - getSettings().maxHoldHours * 3600_000;
  const expired = q.all<{ id: number; in_use_by: number; in_game: number; in_use_since: number }>(
    "SELECT id, in_use_by, in_game, in_use_since FROM accounts WHERE in_use_by IS NOT NULL AND (lease_expires_at < ? OR in_use_since < ?)",
    [now, hardCutoff],
  );
  for (const a of expired) {
    const overCap = a.in_use_since < hardCutoff;
    if (a.in_game && !overCap) {
      const capAt = a.in_use_since + getSettings().maxHoldHours * 3600_000;
      q.run("UPDATE accounts SET lease_expires_at = ? WHERE id = ?", [Math.min(now + 20 * 60_000, capAt), a.id]);
      continue;
    }
    const r = q.run("UPDATE accounts SET in_use_by = NULL, in_use_since = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND in_use_by = ?", [
      now, a.id, a.in_use_by,
    ]);
    if (Number(r.changes)) {
      logActivity(null, "account.auto_release", {
        userId: a.in_use_by,
        accountId: a.id,
        details: { minutes: Math.round((now - a.in_use_since) / 60000), reason: overCap ? "max_hold" : "lease_expired" },
      });
    }
  }
}

const timers: NodeJS.Timeout[] = [];

function every(ms: number, fn: () => unknown, label: string) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[jobs] ${label} failed:`, err);
    }
  };
  timers.push(setInterval(run, ms).unref());
}

export function startJobs() {
  every(60_000, expireLeases, "lease expiry");
  every(6 * 3600_000, housekeeping, "housekeeping");
  every(6 * 3600_000, getDDragon, "ddragon");
  // Live-game check for held accounts (cheap: only accounts in use).
  every(5 * 60_000, () => riotApiKey() && refreshInGame(), "in-game check");
  // Full rank refresh; interval is read each tick so admin changes apply without restart.
  every(60_000, () => {
    if (!riotApiKey()) return;
    const s = refreshStatus();
    const last = s.finishedAt ?? s.startedAt ?? 0;
    if (!s.running && Date.now() - last >= getSettings().rankRefreshMinutes * 60_000) void refreshAll();
  }, "rank refresh");

  void getDDragon();
  housekeeping();
}

export function stopJobs() {
  for (const t of timers) clearInterval(t);
}
