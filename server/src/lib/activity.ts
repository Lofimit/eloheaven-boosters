import type { FastifyRequest } from "fastify";
import { q } from "../db.js";

export function logActivity(
  req: FastifyRequest | null,
  action: string,
  opts: { userId?: number | null; accountId?: number | null; details?: Record<string, unknown> } = {},
) {
  q.run("INSERT INTO activity(user_id, account_id, action, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    opts.userId ?? req?.user?.id ?? null,
    opts.accountId ?? null,
    action,
    opts.details ? JSON.stringify(opts.details) : null,
    req?.ip ?? null,
    Date.now(),
  ]);
}
