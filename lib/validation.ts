import type { ReelStatus } from "./models";
export function validUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost")) return null;
    return url.toString();
  } catch { return null; }
}
export function validDate(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== v ? null : v;
}
export function validDuration(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 86400) throw new Error("Duration must be between 1 and 86,400 seconds.");
  return Math.ceil(n);
}
export const statuses: ReelStatus[] = ["discovered", "delivered", "revision", "approved", "cancelled"];
export { googleFolderId } from "./google-folder";
