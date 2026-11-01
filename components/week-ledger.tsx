"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { generateInvoice } from "@/app/admin/actions";
import { ArrowUpRight, CalendarDays, Clapperboard, CreditCard, Wallet, CheckCircle2, Video, ChevronDown, ChevronLeft, ChevronRight, AlertCircle, Hourglass, FileText, Download } from "lucide-react";
import type { LedgerReel, WeekSummary } from "@/lib/models";
import { CALENDAR_END, CALENDAR_START, durationLabel, formatINR, prettyDate, pricingState, reelFee, sundayFor, todayInIndia, fillWeeks, weekStatus, weekStatusLabel, weekYear } from "@/lib/billing";
import { Empty, Pill, SectionHeading, StatCard, Status } from "./ui";

const YEARS = Array.from({ length: Number(CALENDAR_END.slice(0, 4)) - Number(CALENDAR_START.slice(0, 4)) + 1 }, (_, i) => String(Number(CALENDAR_START.slice(0, 4)) + i));
const statusTone = { no_charges: "neutral", unpaid: "red", partial: "orange", paid: "green" } as const;

function reelSource(source: LedgerReel["source"]) {
  return source === "google_drive" ? "Google Drive" : source === "onedrive" ? "Legacy OneDrive link" : "Manual entry";
}
export function FileAccess({ reel }: { reel: LedgerReel }) {
  const url = reel.client_url || reel.drive_web_url;
  return url ? <a className="file-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${reel.title} in Google Drive`}><ArrowUpRight size={16} /><span>Open file</span></a> : <span className="muted">Not shared</span>;
}
export function FeeLabel({ reel }: { reel: LedgerReel }) {
  const state = pricingState(reel);
  if (state === "review") return <Pill tone="orange">Pricing review</Pill>;
  return <span title={state === "confirmed" ? "Confirmed price for a longer reel" : "Standard reel up to 60 seconds"}>{formatINR(reelFee(reel))}{state === "confirmed" && <small className="fee-note"> confirmed</small>}</span>;
}
/** Shown when a reel delivered in a later week counts in this one (e.g. changes delivered the following Monday). */
function MovedNote({ reel }: { reel: LedgerReel }) {
  return reel.delivery_date && reel.week_ending && reel.week_ending !== sundayFor(reel.delivery_date) ? <small className="moved-note">counted in this week</small> : null;
}
function WeekReels({ week }: { week: WeekSummary }) {
  const visible = [...week.reels].sort((a, b) => (b.delivery_date || "").localeCompare(a.delivery_date || ""));
  if (!visible.length) return <Empty title="No reels delivered this week" description="This is an empty billing week, not missing data. Reels appear here as soon as they're marked delivered." icon={<Clapperboard />} />;
  return <>
    <div className="table-scroll desktop-delivery-table" role="region" aria-label="Weekly delivery table" tabIndex={0}>
      <table className="data-table"><thead><tr><th scope="col">REEL / VIDEO</th><th scope="col">DELIVERED</th><th scope="col">DURATION</th><th scope="col">STATUS</th><th scope="col" className="align-right">AMOUNT</th><th scope="col" className="align-right">GOOGLE DRIVE</th></tr></thead>
        <tbody>{visible.map(reel => <tr key={reel.key}>
          <td><div className="file-name"><span className="small-file-icon"><Video size={16} /></span><span><strong title={reel.title}>{reel.title}</strong><small>{reelSource(reel.source)}</small></span></div></td>
          <td>{prettyDate(reel.delivery_date!)}<MovedNote reel={reel} /></td><td className="mono">{durationLabel(reel.duration_seconds)}</td><td><Status status={reel.status} /></td>
          <td className="align-right strong mono"><FeeLabel reel={reel} /></td>
          <td className="align-right"><FileAccess reel={reel} /></td>
        </tr>)}</tbody></table>
    </div>
    <ul className="mobile-delivery-list" aria-label="Reels delivered this week">{visible.map(reel => <li className="mobile-reel-card" key={reel.key}>
      <div className="mobile-reel-top"><div className="mobile-reel-title"><span className="small-file-icon"><Video size={17} /></span><div><strong>{reel.title}</strong><small>{reelSource(reel.source)}</small></div></div><Status status={reel.status} /></div>
      <div className="mobile-reel-details"><span>{prettyDate(reel.delivery_date!)}<MovedNote reel={reel} /></span><span>{durationLabel(reel.duration_seconds)}</span><strong><FeeLabel reel={reel} /></strong></div>
      <div className="mobile-reel-action"><FileAccess reel={reel} /></div>
    </li>)}</ul>
  </>;
}
/** Admin only: weekly invoices by week ending, so the selected week can be invoiced from the log. */
export type WeekInvoiceLink = { id: string; number: string; state: string };
function WeekInvoiceBar({ week, invoice }: { week: WeekSummary; invoice?: WeekInvoiceLink }) {
  if (invoice) return <div className="week-invoice-bar done"><FileText size={16} aria-hidden /><span>Invoice <strong>{invoice.number}</strong> · {invoice.state}</span><a className="button secondary" href={`/api/invoices/${invoice.id}/pdf`}><Download size={15} aria-hidden /> {invoice.number}.pdf</a></div>;
  if (week.count === 0 || week.starting > todayInIndia()) return null;
  return <form action={generateInvoice} className="week-invoice-bar">
    <input type="hidden" name="kind" value="weekly" /><input type="hidden" name="date" value={week.starting} />
    <FileText size={16} aria-hidden /><span>{week.count} billed reel{week.count === 1 ? "" : "s"} · {formatINR(week.billed)} not invoiced yet</span>
    <InvoiceSubmit />
  </form>;
}
function InvoiceSubmit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="button primary" disabled={pending} aria-busy={pending}>{pending ? "Generating…" : "Generate weekly invoice"}</button>;
}
export function WeekLedger({ weeks: sparse, clientView = false, weekInvoices }: { weeks: WeekSummary[]; clientView?: boolean; weekInvoices?: Record<string, WeekInvoiceLink> }) {
  // The server sends only weeks with activity; empty weeks are rebuilt here so every week stays selectable.
  const weeks = useMemo(() => fillWeeks(sparse, todayInIndia()), [sparse]);
  const current = sundayFor(todayInIndia());
  const ordered = useMemo(() => [...weeks].sort((a, b) => a.ending.localeCompare(b.ending)), [weeks]);
  const [end, setEnd] = useState(weeks.some(w => w.ending === current) ? current : weeks[0]?.ending || "");
  const selected = weeks.find(w => w.ending === end) || weeks[0];
  const years = useMemo(() => [...new Set([...YEARS, ...weeks.map(weekYear)])].sort(), [weeks]);
  const activeYear = selected ? weekYear(selected) : YEARS[0];
  const yearWeeks = useMemo(() => ordered.filter(w => weekYear(w) === activeYear), [ordered, activeYear]);
  const selectedIndex = ordered.findIndex(w => w.ending === selected?.ending);
  const chartWeeks = ordered.slice(Math.max(0, selectedIndex - 7), selectedIndex + 1);
  const maximum = Math.max(600, ...chartWeeks.map(w => w.billed));
  const goYear = (year: string) => {
    const matches = ordered.filter(w => weekYear(w) === year);
    if (matches.length) setEnd(matches.some(w => w.ending === current) ? current : matches[0].ending);
  };
  if (!selected) return null;
  const status = weekStatus(selected);
  const credit = selected.due < 0;
  return <section aria-labelledby="weekly-heading">
    <div className="summary-header"><div><div className="eyebrow">WEEKLY BILLING · MONDAY–SUNDAY · 2026–2030</div>
      <h2 id="weekly-heading" className="summary-title">{clientView ? "Weekly reel log & payments" : "Production overview"}</h2>
      <p>Every week has its own Monday–Sunday reel log and payment balance, settled on Sunday.</p></div>
      <div className="billing-navigation" aria-label="Billing week navigation">
        <div className="billing-picker-row"><label className="year-selector"><span>Year</span><select value={activeYear} onChange={e => goYear(e.target.value)} aria-label="Choose billing year">{years.map(y => <option key={y} value={y}>{y}</option>)}</select><ChevronDown size={15} aria-hidden /></label>
          <label className="week-selector"><CalendarDays size={17} aria-hidden /><select value={selected.ending} onChange={e => setEnd(e.target.value)} aria-label="Choose Monday to Sunday billing week">{yearWeeks.map(w => <option key={w.ending} value={w.ending}>{prettyDate(w.starting)} – {prettyDate(w.ending)}{w.ending === current ? " (this week)" : ""}</option>)}</select><ChevronDown size={16} aria-hidden /></label></div>
        <div className="week-stepper"><button type="button" className="week-step" onClick={() => setEnd(ordered[selectedIndex - 1].ending)} disabled={selectedIndex <= 0} aria-label="Previous billing week"><ChevronLeft size={17} /> <span>Previous</span></button>
          <button type="button" className="week-current" onClick={() => setEnd(current)} disabled={selected.ending === current}>Current week</button>
          <button type="button" className="week-step" onClick={() => setEnd(ordered[selectedIndex + 1].ending)} disabled={selectedIndex >= ordered.length - 1} aria-label="Next billing week"><span>Next</span> <ChevronRight size={17} /></button></div>
      </div>
    </div>
    <p className="week-range-announce" aria-live="polite">{prettyDate(selected.starting)} – {prettyDate(selected.ending)} · <span className={`week-status week-status-${status}`}>{weekStatusLabel[status]}</span>{selected.reported.some(c => c.status === "pending") && <span className="week-status week-status-reported">Payment reported</span>}</p>
    {weekInvoices && <WeekInvoiceBar week={selected} invoice={weekInvoices[selected.ending]} />}
    <div className="stats-grid"><StatCard label="Reels delivered" value={selected.delivered} icon={<Clapperboard size={19} />} detail={selected.reviewCount ? `${selected.count} billed · ${selected.reviewCount} in pricing review` : `${selected.count} billed this week`} /><StatCard label="Amount billed" value={formatINR(selected.billed)} icon={<CreditCard size={19} />} detail="₹600 per reel up to 60 s" /><StatCard label="Amount received" value={formatINR(selected.received)} icon={<CheckCircle2 size={19} />} detail={`${selected.payments.length} payment${selected.payments.length === 1 ? "" : "s"} this week`} /><StatCard label={credit ? "Credit" : "Balance due"} value={formatINR(Math.abs(selected.due))} icon={<Wallet size={19} />} detail={weekStatusLabel[status]} featured /></div>
    <div className="content-grid"><section className="surface chart-card"><SectionHeading eyebrow="EARNINGS" title="Weekly performance" description="Eight billing weeks ending at the selected week" />
      <div className="bar-chart" role="group" aria-label="Eight-week billing chart">{chartWeeks.map(w => <button key={w.ending} type="button" title={`${prettyDate(w.ending)} • ${formatINR(w.billed)}`} onClick={() => setEnd(w.ending)} className={`bar-column ${selected.ending === w.ending ? "selected" : ""}`} aria-pressed={selected.ending === w.ending} aria-label={`Week ending ${prettyDate(w.ending)}, billed ${formatINR(w.billed)}`}>
        <span className="bar-amount">{w.billed ? `₹${(w.billed / 1000).toFixed(1)}k` : "₹0"}</span><span className="bar-track"><span className="bar-fill" style={{ height: `${Math.max(4, w.billed / maximum * 100)}%` }} /></span>
        <span className="bar-label">{new Date(`${w.ending}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</span></button>)}</div></section>
      <section className="surface settlement-card"><SectionHeading eyebrow="SUNDAY SETTLEMENT" title="Week settlement" description={`${prettyDate(selected.starting)} – ${prettyDate(selected.ending)}`} /><div className="receipt-lines"><div><span>Billed reels</span><strong>{selected.count}</strong></div>{selected.reviewCount > 0 && <div><span>Awaiting pricing review</span><strong>{selected.reviewCount}</strong></div>}<div><span>Standard rate</span><strong>₹600 / reel</strong></div><div><span>Subtotal</span><strong>{formatINR(selected.billed)}</strong></div><div><span>Paid to date</span><strong className="green-text">– {formatINR(selected.received)}</strong></div><div className="receipt-total"><span>{credit ? "Credit" : "Amount due"}</span><strong>{formatINR(Math.abs(selected.due))}</strong></div></div><Pill tone={statusTone[status]}>{weekStatusLabel[status]}</Pill></section></div>
    <section className="surface log-card"><div className="table-heading"><SectionHeading eyebrow="DELIVERY HISTORY" title="Weekly reel log" description={`${selected.delivered} delivered · ${selected.count} billed · ${prettyDate(selected.starting)} – ${prettyDate(selected.ending)}`} /><span className="soft-label"><span className="live-dot" />LIVE RECORD</span></div><WeekReels week={selected} /></section>
    <section className="surface history-card"><SectionHeading eyebrow="TRANSACTIONS" title="Payment history" description="Full and partial payments allocated to the selected billing week" />
      {selected.payments.length || selected.reported.length ? <ul className="payments-list">
        {selected.reported.map(claim => <li className={`payment-row reported-row reported-${claim.status}`} key={claim.key}><div className="payment-icon"><Hourglass size={18} aria-hidden /></div><div className="payment-info"><strong>{claim.status === "pending" ? "Payment reported · awaiting confirmation" : "Reported payment · not confirmed"}</strong><small>Paid {prettyDate(claim.paid_on)}{claim.status === "rejected" ? " · please contact Advik" : " · not yet counted in the balance"}</small></div><strong className="reported-amount">{formatINR(claim.amount)}</strong></li>)}
        {selected.payments.map(payment => <li className="payment-row" key={payment.id}><div className="payment-icon"><CheckCircle2 size={18} aria-hidden /></div><div className="payment-info"><strong>Payment received</strong><small>{prettyDate(payment.paid_on)}{!clientView && payment.method ? ` · ${payment.method}` : ""}{!clientView && payment.note ? ` · ${payment.note}` : ""}</small></div><strong className="green-text">+ {formatINR(Number(payment.amount))}</strong></li>)}
      </ul> : <div className="no-transactions"><AlertCircle size={18} aria-hidden /><span>No payments recorded for this week.</span></div>}
    </section>
  </section>;
}
export function UnpricedReels({ reels, clientView = false }: { reels: LedgerReel[]; clientView?: boolean }) {
  const excluded = reels.filter(r => pricingState(r) === "review");
  if (!excluded.length) return null;
  return <div className="warning-message" role="status"><AlertCircle size={18} /><div><strong>{excluded.length} delivered reel{excluded.length === 1 ? "" : "s"} awaiting pricing review</strong><p>{clientView ? "These are longer than 60 seconds (or their length is still being confirmed), so they aren't included in the ₹600 totals until a price is agreed." : "Over 60 seconds or unknown length. Set a confirmed price in Edit to bill them; until then they're excluded from totals."}</p></div></div>;
}
