import type { LedgerReel, Payment, Reel } from "./models";
import { BILLED_STATES, confirmedRate } from "./billing";

/** Short, non-reversible display key so internal database IDs never reach the browser. */
export function opaqueKey(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `k${(h >>> 0).toString(36)}`;
}

/** Admin projection: keeps the real ID as the key (the admin UI never leaves the server-rendered admin page). */
export function adminLedgerReel(r: Reel): LedgerReel {
  return {
    key: r.id, title: r.title, source: r.source, status: r.status, delivery_date: r.delivery_date,
    duration_seconds: r.duration_seconds, confirmed_rate_inr: confirmedRate(r), client_url: r.client_url, drive_web_url: r.drive_web_url
  };
}

/** Public projection. Keep this intentionally narrow: never send admin notes,
 * database or cloud-storage identifiers, internal timestamps or connection settings. */
export function publicLedgerReel(r: Reel): LedgerReel {
  return {
    key: opaqueKey(r.id),
    title: r.title,
    source: r.source,
    status: r.status,
    delivery_date: r.delivery_date,
    duration_seconds: r.duration_seconds,
    confirmed_rate_inr: confirmedRate(r),
    client_url: r.client_url,
    drive_web_url: r.client_url ? null : r.drive_web_url
  };
}

export function publicReels(reels: Reel[]): LedgerReel[] {
  return reels.filter(r => Boolean(r.delivery_date) && BILLED_STATES.has(r.status)).map(publicLedgerReel);
}

/** Payment method and reference stay private; the client sees amount and dates only. */
export function publicPayments(payments: Payment[]): Payment[] {
  return payments.map(p => ({ id: opaqueKey(p.id), week_ending: p.week_ending, amount: Number(p.amount), paid_on: p.paid_on, note: null, method: null }));
}
