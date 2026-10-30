/**
 * Client payment reports ("I've paid"), submitted from the public dashboard with an optional screenshot.
 * Pure validation helpers, shared by the API route and the tests. A report never changes balances
 * by itself: it shows as "awaiting confirmation" until the admin confirms it, which records a payment.
 */
import { CALENDAR_END, CALENDAR_START, mondayFor, shiftISODate, sundayFor, todayInIndia } from "./billing";

export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const CLAIM_METHODS = ["UPI", "Bank transfer", "Cash", "Other"] as const;
export type ScreenshotType = "image/jpeg" | "image/png" | "image/webp";

export type ClaimInput = { week_ending: string; amount: number; paid_on: string; method: string | null; reference: string | null; note: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(v: string): boolean {
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || null;

/** Validate a report. Throws an Error with a message that's safe to show to the client. */
export function validateClaim(form: FormData, now = new Date()): ClaimInput {
  const today = todayInIndia(now);
  const week = String(form.get("week_ending") ?? "");
  if (!isoDate(week) || sundayFor(week) !== week) throw new Error("Choose the billing week this payment is for.");
  if (week < sundayFor(CALENDAR_START) || week > sundayFor(CALENDAR_END)) throw new Error("That billing week is outside 2026–2030.");
  if (mondayFor(week) > today) throw new Error("You can't report a payment for a week that hasn't started yet.");
  const rawAmount = String(form.get("amount") ?? "").replace(/[,₹\s]/g, "");
  const amount = Number(rawAmount);
  if (!rawAmount || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new Error("Enter the amount you paid in rupees.");
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) throw new Error("The amount can have at most two decimal places.");
  const paid = String(form.get("paid_on") ?? "");
  if (!isoDate(paid)) throw new Error("Enter the date you paid.");
  if (paid > shiftISODate(today, 1)) throw new Error("The payment date can't be in the future.");
  if (paid < mondayFor(CALENDAR_START)) throw new Error("The payment date is too far in the past.");
  const method = text(form.get("method"), 40);
  if (method && !(CLAIM_METHODS as readonly string[]).includes(method)) throw new Error("Choose how you paid.");
  return { week_ending: week, amount: Math.round(amount * 100) / 100, paid_on: paid, method, reference: text(form.get("reference"), 120), note: text(form.get("note"), 500) };
}

/** Identify an image by its first bytes, never by the name or type the browser claims. */
export function sniffImage(bytes: Uint8Array): ScreenshotType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
export const extensionFor: Record<ScreenshotType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
