import type { Payment, LedgerReel, WeekSummary } from "./models";

export const RATE_INR = 600;
export const CALENDAR_START = "2026-01-01";
export const CALENDAR_END = "2030-12-31";
const BILLED_STATES = new Set(["delivered", "revision", "approved"]);

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
export function todayInIndia(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function billable(reel: LedgerReel): boolean {
  return !!reel.delivery_date && BILLED_STATES.has(reel.status) && reel.duration_seconds !== null &&
    Number.isFinite(reel.duration_seconds) && reel.duration_seconds > 0 && reel.duration_seconds <= 60;
}
export function reelFee(reel: LedgerReel): number { return billable(reel) ? RATE_INR : 0; }
/** All consecutive Monday–Sunday billing periods covering 2026 through 2030.
 * The first/last period may cross a calendar-year boundary. */
export function billingCalendar(): {starting:string;ending:string}[] {
  const out:{starting:string;ending:string}[]=[];
  let start=mondayFor(CALENDAR_START);
  const last=sundayFor(CALENDAR_END);
  while(start<=last){out.push({starting:start,ending:shiftISODate(start,6)});start=shiftISODate(start,7);}
  return out;
}
export function buildLedger(reels: LedgerReel[], payments: Payment[], today: string): WeekSummary[] {
  const weeks = new Map<string, WeekSummary>();
  function ensure(end: string): WeekSummary {
    let w = weeks.get(end);
    if (!w) {
      w = { ending: end, starting: shiftISODate(end, -6), count: 0, billed: 0, received: 0, due: 0, reels: [], payments: [] };
      weeks.set(end, w);
    }
    return w;
  }
  // Pre-generate every week so users can explicitly browse empty weeks and years.
  for (const period of billingCalendar()) ensure(period.ending);
  ensure(sundayFor(today));
  // Preserve older legacy entries as separate weeks even if outside the five-year calendar.
  for (const reel of reels) {
    // The delivery log contains every delivered reel, including overlength and
    // unknown-duration files; only eligible files contribute to the invoice.
    if (!reel.delivery_date || !BILLED_STATES.has(reel.status)) continue;
    const w = ensure(sundayFor(reel.delivery_date));
    w.reels.push(reel);
    if (billable(reel)) { w.count++; w.billed += RATE_INR; }
  }
  for (const pay of payments) {
    const w = ensure(pay.week_ending);
    w.payments.push(pay); w.received += Number(pay.amount);
  }
  for (const w of weeks.values()) w.due = w.billed - w.received;
  return [...weeks.values()].sort((a,b) => b.ending.localeCompare(a.ending));
}
export function formatINR(n: number): string { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n); }
export function prettyDate(iso: string): string { return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
export function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2,"0")}`;
}
