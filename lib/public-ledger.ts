import type { LedgerReel, Payment, Reel } from "./models";

const SHARED_STATES = new Set(["delivered", "approved", "revision"]);

/** Keep the public payload intentionally narrow: never send admin notes,
 * cloud-storage source identifiers, internal timestamps or connection settings. */
export function publicReels(reels: Reel[]): LedgerReel[] {
  return reels
    .filter(r => Boolean(r.delivery_date) && SHARED_STATES.has(r.status))
    .map(r => ({
      id: r.id,
      title: r.title,
      source: r.source,
      status: r.status,
      delivery_date: r.delivery_date,
      duration_seconds: r.duration_seconds,
      client_url: r.client_url,
      drive_web_url: r.client_url ? null : r.drive_web_url
    }));
}

export function publicPayments(payments: Payment[]): Payment[] {
  return payments.map(p => ({
    id: p.id, week_ending: p.week_ending, amount: p.amount,
    paid_on: p.paid_on, note: null
  }));
}
