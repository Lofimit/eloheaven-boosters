import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = "Please sign in") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "You don't have access to this") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "not_found");
export const conflict = (msg: string) => new HttpError(409, msg, "conflict");

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw badRequest(`${where}${issue?.message ?? "Invalid input"}`);
  }
  return r.data;
}

export function jsonArray<T = unknown>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function jsonObject<T extends object = Record<string, unknown>>(s: string | null | undefined): T {
  if (!s) return {} as T;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : ({} as T);
  } catch {
    return {} as T;
  }
}
