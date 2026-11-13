import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "../config.js";

const scrypt = promisify(crypto.scrypt) as (
  pw: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  len: number,
  opts: crypto.ScryptOptions,
) => Promise<Buffer>;

const secret = config.appSecret || "dev-only-insecure-secret-change-me-please-0000";
const encKey = Buffer.from(crypto.hkdfSync("sha256", secret, "eloheaven", "credentials-v1", 32));

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("Unsupported ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("base64url");

/** Human-friendly key for the desktop client, e.g. EH-7K3Q-…  */
export function newClientKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `EH-${out.match(/.{5}/g)!.join("-")}`;
}
