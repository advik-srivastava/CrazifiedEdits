/**
 * Renders a CrazifiedEdits invoice as an A4 PDF (no GST). Pure: fonts and logo are passed in as bytes,
 * so this runs the same on Vercel, locally and in tests.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { InvoiceItem, InvoiceKind, InvoiceProfile } from "./invoices";
import { invoicePayState, payStateLabel, periodLabel } from "./invoices";

export type InvoicePdfData = {
  number: string; kind: InvoiceKind; period_start: string; period_end: string; issue_date: string; due_date: string;
  items: InvoiceItem[]; total: number; paid: number; profile: InvoiceProfile; notes: string | null; voided: boolean;
};
export type InvoiceAssets = { regular: Uint8Array; bold: Uint8Array; heavy: Uint8Array; logo?: Uint8Array | null };

const A4 = { w: 595.28, h: 841.89 };
const M = 40;
const C = {
  ink: rgb(0.075, 0.094, 0.153), muted: rgb(0.49, 0.52, 0.58), line: rgb(0.89, 0.9, 0.93), band: rgb(0.071, 0.071, 0.09),
  primary: rgb(0.388, 0.337, 0.91), tint: rgb(0.957, 0.949, 1), white: rgb(1, 1, 1), green: rgb(0.03, 0.53, 0.36), red: rgb(0.75, 0.27, 0.27),
  lilac: rgb(0.78, 0.75, 1)
};
const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const length = (s: number | null) => s === null ? "—" : `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, "0")}`;

export async function renderInvoicePdf(d: InvoicePdfData, a: InvoiceAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Invoice ${d.number}`); doc.setAuthor(d.profile.business_name); doc.setCreator("CrazifiedEdits"); doc.setProducer("CrazifiedEdits");
  doc.setSubject(`Video editing services, ${periodLabel(d.kind, d.period_start, d.period_end, day)}`);
  const regular = await doc.embedFont(a.regular, { subset: true });
  const bold = await doc.embedFont(a.bold, { subset: true });
  const heavy = await doc.embedFont(a.heavy, { subset: true });
  const logo = a.logo ? await doc.embedPng(a.logo).catch(() => null) : null;

  // Characters the embedded fonts can't draw (e.g. emoji in a file name) become "?" instead of breaking the PDF.
  const supported = new Set([...regular.getCharacterSet(), ...bold.getCharacterSet()]);
  const safe = (s: string) => [...(s || "")].filter(ch => ch === "\n" || supported.has(ch.codePointAt(0)!)).join("").replace(/[ \t]{2,}/g, " ").replace(/ +\./g, ".");
  const fit = (s: string, font: PDFFont, size: number, max: number) => {
    let t = safe(s);
    if (font.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > max) t = t.slice(0, -1);
    return t.trimEnd() + "…";
  };
  const wrap = (s: string, font: PDFFont, size: number, max: number, maxLines = 6) => {
    const out: string[] = [];
    for (const para of safe(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= max) line = next;
        else { if (line) out.push(line); line = fit(word, font, size, max); }
      }
      if (line) out.push(line);
    }
    return out.slice(0, maxLines);
  };
  const text = (p: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont = regular, color = C.ink) =>
    p.drawText(safe(s), { x, y, size, font, color });
  const right = (p: PDFPage, s: string, xRight: number, y: number, size: number, font: PDFFont = regular, color = C.ink) =>
    p.drawText(safe(s), { x: xRight - font.widthOfTextAtSize(safe(s), size), y, size, font, color });

  const pages: PDFPage[] = [];
  const period = periodLabel(d.kind, d.period_start, d.period_end, day);
  // Compact range for the meta box: "26 Oct – 1 Nov 2026" (year shown once when both dates share it).
  const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const compactPeriod = d.kind === "daily" ? day(d.period_start) : d.period_start.slice(0, 4) === d.period_end.slice(0, 4) ? `${shortDay(d.period_start)} – ${day(d.period_end)}` : period;
  const state = invoicePayState(d.total, d.paid, d.voided);
  const balance = Math.max(0, Math.round((d.total - d.paid) * 100) / 100);

  // ---------------------------------------------------------------- page 1 header
  let page = doc.addPage([A4.w, A4.h]); pages.push(page);
  page.drawRectangle({ x: 0, y: A4.h - 112, width: A4.w, height: 112, color: C.band });
  if (logo) {
    const h = 34, w = logo.width * (h / logo.height);
    page.drawImage(logo, { x: M, y: A4.h - 62, width: w, height: h });
  } else text(page, d.profile.business_name.toUpperCase(), M, A4.h - 56, 20, heavy, C.white);
  text(page, `${d.profile.business_name} · Video editing`, M, A4.h - 86, 9, regular, C.lilac);
  right(page, "INVOICE", A4.w - M, A4.h - 56, 26, heavy, C.white);
  right(page, d.number, A4.w - M, A4.h - 78, 11, bold, C.lilac);

  // ---------------------------------------------------------------- parties + meta
  let y = A4.h - 150;
  const col = (title: string, lines: string[], x: number, width: number) => {
    text(page, title, x, y, 8, bold, C.primary);
    let yy = y - 16;
    lines.forEach((l, i) => {
      for (const w of wrap(l, i === 0 ? bold : regular, i === 0 ? 11 : 9, width, 3)) { text(page, w, x, yy, i === 0 ? 11 : 9, i === 0 ? bold : regular, i === 0 ? C.ink : C.muted); yy -= i === 0 ? 15 : 12; }
    });
    return yy;
  };
  const from = [d.profile.business_name, d.profile.owner_name ? `${d.profile.owner_name} (Editor)` : "", d.profile.address, d.profile.email, d.profile.phone].filter(Boolean);
  const to = [d.profile.client_name, d.profile.client_handle, d.profile.client_address, d.profile.client_email].filter(Boolean);
  const y1 = col("BILLED BY", from, M, 160);
  const y2 = col("BILLED TO", to, M + 180, 135);
  // meta box
  const mx = A4.w - M - 190, mw = 190;
  const meta: [string, string][] = [["Invoice no.", d.number], ["Issue date", day(d.issue_date)], ["Due date", d.due_date === d.issue_date ? `${day(d.due_date)} (on receipt)` : day(d.due_date)], [d.kind === "weekly" ? "Billing week" : "Billing day", compactPeriod]];
  const mh = meta.length * 18 + 14;
  page.drawRectangle({ x: mx, y: y - mh + 10, width: mw, height: mh, color: C.tint });
  meta.forEach(([k, v], i) => {
    const yy = y - 6 - i * 18;
    text(page, k, mx + 10, yy, 8.5, regular, C.muted);
    right(page, fit(v, bold, 8.5, 118), mx + mw - 10, yy, 8.5, bold);
  });
  y = Math.min(y1, y2, y - mh) - 22;

  // ---------------------------------------------------------------- items table
  const cols = { n: M + 8, title: M + 30, date: A4.w - M - 205, len: A4.w - M - 120, amt: A4.w - M - 8 };
  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - 8, width: A4.w - 2 * M, height: 24, color: C.band });
    text(page, "#", cols.n, y, 8, bold, C.white);
    text(page, "REEL / VIDEO", cols.title, y, 8, bold, C.white);
    text(page, "DELIVERED", cols.date, y, 8, bold, C.white);
    text(page, "LENGTH", cols.len, y, 8, bold, C.white);
    right(page, "AMOUNT", cols.amt, y, 8, bold, C.white);
    y -= 26;
  };
  drawHead();
  const ROW = 22, FOOTER_SPACE = 70;
  d.items.forEach((item, i) => {
    if (y < FOOTER_SPACE + ROW) {
      page = doc.addPage([A4.w, A4.h]); pages.push(page);
      text(page, `Invoice ${d.number} (continued)`, M, A4.h - M - 6, 11, bold);
      text(page, period, M, A4.h - M - 22, 9, regular, C.muted);
      y = A4.h - M - 52; drawHead();
    }
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 7, width: A4.w - 2 * M, height: ROW, color: rgb(0.98, 0.98, 0.99) });
    text(page, String(i + 1), cols.n, y, 9, regular, C.muted);
    text(page, fit(item.title, regular, 9, cols.date - cols.title - 12), cols.title, y, 9);
    text(page, day(item.delivered), cols.date, y, 9, regular, C.muted);
    text(page, length(item.seconds), cols.len, y, 9, regular, C.muted);
    right(page, inr(item.amount), cols.amt, y, 9, bold);
    y -= ROW;
  });
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: A4.w - M, y: y + 12 }, thickness: 0.8, color: C.line });

  // ---------------------------------------------------------------- totals (+ payment details beside them)
  const totalsHeight = 128;
  if (y - totalsHeight < FOOTER_SPACE) { page = doc.addPage([A4.w, A4.h]); pages.push(page); y = A4.h - M - 20; }
  y -= 8;
  const tx = A4.w - M - 210, tw = 210;
  const line = (label: string, value: string, opts: { strong?: boolean; color?: typeof C.ink } = {}) => {
    text(page, label, tx + 10, y, opts.strong ? 11 : 9, opts.strong ? bold : regular, opts.strong ? C.ink : C.muted);
    right(page, value, tx + tw - 10, y, opts.strong ? 13 : 9.5, opts.strong ? heavy : bold, opts.color ?? C.ink);
    y -= opts.strong ? 22 : 16;
  };
  const yTotals = y;
  line(`Subtotal (${d.items.length} reel${d.items.length === 1 ? "" : "s"})`, inr(d.total));
  line("GST", "Not charged");
  page.drawLine({ start: { x: tx + 10, y: y + 8 }, end: { x: tx + tw - 10, y: y + 8 }, thickness: 0.6, color: C.line });
  y -= 4;
  line("Total", inr(d.total), { strong: true });
  if (d.paid > 0) line("Paid", `– ${inr(d.paid)}`, { color: C.green });
  y -= 6;
  page.drawRectangle({ x: tx, y: y - 10, width: tw, height: 28, color: state === "paid" ? rgb(0.91, 0.97, 0.94) : C.tint });
  text(page, state === "void" ? "Void" : "Balance due", tx + 10, y, 11, bold);
  right(page, state === "void" ? "—" : inr(balance), tx + tw - 10, y - 1, 14, heavy, state === "paid" ? C.green : C.primary);
  const yAfterTotals = y - 24;

  // payment details on the left
  y = yTotals;
  const payLines: string[] = [];
  if (d.profile.upi_id) payLines.push(`UPI: ${d.profile.upi_id}`);
  if (d.profile.bank_details) payLines.push(...d.profile.bank_details.split("\n"));
  text(page, "PAYMENT DETAILS", M, y, 8, bold, C.primary); y -= 15;
  for (const l of (payLines.length ? payLines : ["Payment details on request."])) for (const w of wrap(l, regular, 9, tx - M - 20, 4)) { text(page, w, M, y, 9); y -= 12; }
  for (const w of wrap(`Please mention ${d.number} in the payment note. ${d.due_date === d.issue_date ? `Due on receipt (${day(d.due_date)})` : `Payable by ${day(d.due_date)}`}.`, regular, 8.5, tx - M - 20, 3)) { text(page, w, M, y, 8.5, regular, C.muted); y -= 11; }
  y = Math.min(y - 10, yAfterTotals);

  // ---------------------------------------------------------------- notes + thanks
  const extra = [d.notes || "", d.profile.footer_note].filter(Boolean);
  for (const block of extra) {
    const lines = wrap(block, regular, 9, A4.w - 2 * M, 6);
    if (y - lines.length * 12 < FOOTER_SPACE - 10) break;
    for (const l of lines) { text(page, l, M, y, 9, regular, C.muted); y -= 12; }
    y -= 6;
  }

  // ---------------------------------------------------------------- stamp + page footers
  if (state === "paid" || state === "void") {
    // Status badge in the header, under the invoice number.
    const first = pages[0], label = state === "paid" ? "PAID" : "VOID", size = 9;
    const w = heavy.widthOfTextAtSize(label, size) + 18;
    first.drawRectangle({ x: A4.w - M - w, y: A4.h - 104, width: w, height: 17, color: state === "paid" ? rgb(0.13, 0.55, 0.38) : C.red });
    first.drawText(label, { x: A4.w - M - w + 9, y: A4.h - 99, size, font: heavy, color: C.white });
  }
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 42 }, end: { x: A4.w - M, y: 42 }, thickness: 0.6, color: C.line });
    text(p, `${d.profile.business_name} · Invoice ${d.number} · ${payStateLabel[state]}`, M, 28, 8, regular, C.muted);
    right(p, `Page ${i + 1} of ${pages.length}`, A4.w - M, 28, 8, regular, C.muted);
  });
  return doc.save();
}
