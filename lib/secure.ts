import "server-only";
import { randomBytes, createCipheriv, createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

function key(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.ONEDRIVE_ENCRYPTION_KEY;
  // Tolerate copy-paste slips: whitespace or quotes around the value.
  const hex = raw?.trim().replace(/^["']|["']$/g, "").trim();
  if (!hex) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.");
  if (!/^[a-f\d]{64}$/i.test(hex)) throw new Error(`GOOGLE_TOKEN_ENCRYPTION_KEY must be exactly 64 characters of 0-9 and a-f (yours has ${hex.length}). Generate one with: node scripts/generate-secrets.mjs`);
  return Buffer.from(hex, "hex");
}
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",key(),iv);
  const encrypted = Buffer.concat([cipher.update(plain,"utf8"),cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptToken(value: string): string {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}
export function randomValue() { return randomBytes(32).toString("base64url"); }
export function challenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
