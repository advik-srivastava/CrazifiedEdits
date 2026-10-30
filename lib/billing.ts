import type { DayActivity, LedgerReel, LedgerTotals, Payment, Reel, WeekPaymentStatus, WeekSummary } from "./models";

/** Agreed commercial terms. Do not change without a new agreement with the client. */
export const RATE_INR = 600;
export const STANDARD_MAX_SECONDS = 60;
export const BUSINESS_TIMEZONE = "Asia/Kolkata";
export const CALENDAR_START = "2026-01-01";
export const CALENDAR_END = "2030-12-31";
export const BILLED_STATES = new Set(["delivered", "revision", "approved"]);

/** Dates are ISO YYYY-MM-DD date-only values, avoiding server timezone drift. */
export function shiftISODate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error("Invalid ISO date");
  const t = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso) throw new Error("Invalid ISO date");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
export function sundayFor(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return shiftISODate(iso, 7 - (day || 7));
}
export function mondayFor(iso: string): string { return shiftISODate(sundayFor(iso), -6); }
/** Calendar date in India for an instant. Midnight IST is 18:30 UTC of the previous day. */
export function todayInIndia(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function istDateOf(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const t = new Date(timestamp);
  return Number.isNaN(t.getTime()) ? null : todayInIndia(t);
}
/** Milliseconds until the next midnight in India, used to roll Today/Yesterday over without a redeploy. */
export function msUntilIndiaMidnight(now = new Date()): number {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India has no daylight saving time.
  const local = now.getTime() + IST_OFFSET_MS;
  const nextMidnightLocal = (Math.floor(local / 86_400_000) + 1) * 86_400_000;
  return nextMidnightLocal - local;
}

type Priceable = Pick<LedgerReel, "status" | "delivery_date" | "duration_seconds"> & { confirmed_rate_inr?: number | string | null };
export type PricingState = "not_billable" | "standard" | "confirmed" | "review";

export function confirmedRate(reel: Priceable): number | null {
  const n = reel.confirmed_rate_inr === null || reel.confirmed_rate_inr === undefined ? NaN : Number(reel.confirmed_rate_inr);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function withinStandardLength(seconds: number | null | undefined): boolean {
  return seconds !== null && seconds !== undefined && Number.isFinite(seconds) && seconds > 0 && seconds <= STANDARD_MAX_SECONDS;
}
/**
 * How a reel is priced:
 * - not_billable: not delivered (pending review, cancelled, or no delivery date).
 * - standard: delivered and up to 60 seconds, billed at the fixed ₹600.
 * - confirmed: longer or unknown duration with a price the admin explicitly confirmed.
 * - review: longer or unknown duration with no confirmed price yet; excluded from billing.
 */
export function pricingState(reel: Priceable): PricingState {
  if (!reel.delivery_date || !BILLED_STATES.has(reel.status)) return "not_billable";
  if (withinStandardLength(reel.duration_seconds)) return "standard";
  return confirmedRate(reel) !== null ? "confirmed" : "review";
}
export function reelFee(reel: Priceable): number {
  const state = pricingState(reel);
  if (state === "standard") return RATE_INR;
  if (state === "confirmed") return confirmedRate(reel)!;
  return 0;
}
export function billable(reel: Priceable): boolean { return reelFee(reel) > 0; }

/** All consecutive Monday–Sunday billing periods covering 2026 through 2030.
 * The first/last period may cross a calendar-year boundary. */
export function billingCalendar(): { starting: string; ending: string }[] {
  const out: { starting: string; ending: string }[] = [];
  let start = mondayFor(CALENDAR_START);
  const last = sundayFor(CALENDAR_END);
  while (start <= last) { out.push({ starting: start, ending: shiftISODate(start, 6) }); start = shiftISODate(start, 7); }
  return out;
}
/** The calendar year a billing week is filed under: the year its Monday falls in,
 * except the week containing 1 Jan 2026, which belongs to 2026. */
export function weekYear(week: { starting: string; ending: string }): string {
  return week.starting < CALENDAR_START && week.ending >= CALENDAR_START ? CALENDAR_START.slice(0, 4) : week.starting.slice(0, 4);
}
export function buildLedger(reels: LedgerReel[], payments: Payment[], today: string): WeekSummary[] {
  const weeks = new Map<string, WeekSummary>();
  function ensure(end: string): WeekSummary {
    let w = weeks.get(end);
    if (!w) {
      w = { ending: end, starting: shiftISODate(end, -6), count: 0, delivered: 0, reviewCount: 0, billed: 0, received: 0, due: 0, reels: [], payments: [] };
      weeks.set(end, w);
    }
    return w;
  }
  // Pre-generate every week so users can explicitly browse empty weeks and years.
  for (const period of billingCalendar()) ensure(period.ending);
  ensure(sundayFor(today));
  for (const reel of reels) {
    // The delivery log contains every delivered reel, including ones awaiting a
    // pricing review; only priced reels contribute to the invoice.
    if (!reel.delivery_date || !BILLED_STATES.has(reel.status)) continue;
    const w = ensure(sundayFor(reel.delivery_date));
    w.reels.push(reel);
    w.delivered++;
    const fee = reelFee(reel);
    if (fee > 0) { w.count++; w.billed += fee; } else w.reviewCount++;
  }
  for (const pay of payments) {
    const w = ensure(pay.week_ending);
    w.payments.push(pay); w.received += Number(pay.amount);
  }
  for (const w of weeks.values()) {
    w.billed = roundMoney(w.billed); w.received = roundMoney(w.received);
    w.due = roundMoney(w.billed - w.received);
    w.payments.sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  }
  return [...weeks.values()].sort((a, b) => b.ending.localeCompare(a.ending));
}
function roundMoney(n: number): number { return Math.round(n * 100) / 100; }

export function weekStatus(week: Pick<WeekSummary, "billed" | "received">): WeekPaymentStatus {
  if (week.billed <= 0 && week.received <= 0) return "no_charges";
  if (week.received >= week.billed) return "paid";
  if (week.received > 0) return "partial";
  return "unpaid";
}
export const weekStatusLabel: Record<WeekPaymentStatus, string> = { no_charges: "No charges", unpaid: "Unpaid", partial: "Partially paid", paid: "Paid" };

export function ledgerTotals(weeks: WeekSummary[]): LedgerTotals {
  const t = weeks.reduce((acc, w) => ({
    delivered: acc.delivered + w.delivered, billedReels: acc.billedReels + w.count, billed: acc.billed + w.billed,
    received: acc.received + w.received, outstanding: 0, reviewCount: acc.reviewCount + w.reviewCount
  }), { delivered: 0, billedReels: 0, billed: 0, received: 0, outstanding: 0, reviewCount: 0 });
  t.billed = roundMoney(t.billed); t.received = roundMoney(t.received);
  t.outstanding = roundMoney(t.billed - t.received);
  return t;
}

/** Upload date in India: when the file was created in Google Drive, else when CrazifiedEdits first saw it. */
export function uploadDateOf(reel: Pick<Reel, "first_seen_at" | "drive_created_at" | "source">): string | null {
  return istDateOf(reel.drive_created_at || reel.first_seen_at);
}
/** Activity for one India calendar date. Upload date and delivery date are counted independently. */
export function dayActivity(reels: Reel[], date: string, toLedger: (r: Reel) => LedgerReel): DayActivity {
  let uploaded = 0, pendingReview = 0, billed = 0;
  const deliveredReels: LedgerReel[] = [];
  for (const r of reels) {
    if (r.status !== "cancelled" && uploadDateOf(r) === date) {
      uploaded++;
      if (r.status === "discovered") pendingReview++;
    }
    if (r.delivery_date === date && BILLED_STATES.has(r.status)) {
      const reel = toLedger(r);
      deliveredReels.push(reel);
      billed += reelFee(reel);
    }
  }
  return { date, uploaded, delivered: deliveredReels.length, billed: roundMoney(billed), pendingReview, deliveredReels };
}
export function todayAndYesterday(reels: Reel[], toLedger: (r: Reel) => LedgerReel, now = new Date()) {
  const today = todayInIndia(now);
  return { today: dayActivity(reels, today, toLedger), yesterday: dayActivity(reels, shiftISODate(today, -1), toLedger) };
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
}
export function prettyDate(iso: string): string { return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
export function prettyDateTime(ts: string): string {
  return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TIMEZONE });
}
export function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
