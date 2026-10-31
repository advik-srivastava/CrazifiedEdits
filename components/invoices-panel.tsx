"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarDays, CalendarRange, CheckCircle2, ChevronDown, Download, Eye, FileText, Settings2, Trash2, Wallet, XCircle } from "lucide-react";
import type { WeekSummary } from "@/lib/models";
import type { AdminInvoice } from "@/lib/invoices-server";
import { historyTab, payStateLabel, periodLabel, periodsOverlap, type InvoiceHistoryTab, type InvoiceProfile } from "@/lib/invoices";
import { CALENDAR_END, CALENDAR_START, formatINR, prettyDate, sundayFor, weekYear } from "@/lib/billing";
import { paymentMethods } from "@/lib/validation";
import { deleteVoidInvoice, generateInvoice, recordInvoicePayment, saveInvoiceDetails, voidInvoice } from "@/app/admin/actions";
import { Empty, Pill, SectionHeading } from "./ui";

const tone = { unpaid: "red", partial: "orange", paid: "green", void: "neutral" } as const;
function Submit({ children, variant = "primary", pending = "Working…", className = "" }: { children: React.ReactNode; variant?: string; pending?: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return <button type="submit" className={`button ${variant} ${className}`} disabled={busy} aria-busy={busy}>{busy ? pending : children}</button>;
}
const confirmSubmit = (msg: string) => (e: React.FormEvent<HTMLFormElement>) => { if (!confirm(msg)) e.preventDefault(); };

const YEARS = Array.from({ length: Number(CALENDAR_END.slice(0, 4)) - Number(CALENDAR_START.slice(0, 4)) + 1 }, (_, k) => String(Number(CALENDAR_START.slice(0, 4)) + k));
const covering = (invoices: AdminInvoice[], start: string, end: string) =>
  invoices.filter(i => i.status === "issued" && periodsOverlap({ start, end }, { start: i.period_start, end: i.period_end }));

/** Weekly invoice (the main one): same Year / Week choice as the weekly reel log. */
function WeeklyInvoice({ weeks, today, invoices }: { weeks: WeekSummary[]; today: string; invoices: AdminInvoice[] }) {
  const ordered = useMemo(() => [...weeks].sort((a, b) => a.ending.localeCompare(b.ending)), [weeks]);
  const current = sundayFor(today);
  const [ending, setEnding] = useState(current);
  const week = ordered.find(w => w.ending === ending) || ordered[ordered.length - 1];
  const year = weekYear(week);
  const yearWeeks = ordered.filter(w => weekYear(w) === year && w.starting <= today);
  const goYear = (y: string) => { const list = ordered.filter(w => weekYear(w) === y && w.starting <= today); if (list.length) setEnding(list.some(w => w.ending === current) ? current : list[list.length - 1].ending); };
  const onWeek = covering(invoices, week.starting, week.ending);
  const weekly = onWeek.find(i => i.kind === "weekly");
  const dailies = onWeek.filter(i => i.kind === "daily");
  return <div className="weekly-invoice">
    <div className="weekly-invoice-head"><CalendarRange size={22} aria-hidden /><span><strong>Weekly invoice</strong><small>Monday–Sunday, settled on Sunday</small></span></div>
    <div className="billing-picker-row invoice-pickers">
      <label className="year-selector"><span>Year</span><select value={year} onChange={e => goYear(e.target.value)} aria-label="Invoice year">{YEARS.filter(y => y <= today.slice(0, 4)).map(y => <option key={y} value={y}>{y}</option>)}</select><ChevronDown size={15} aria-hidden /></label>
      <label className="week-selector"><CalendarDays size={17} aria-hidden /><select value={week.ending} onChange={e => setEnding(e.target.value)} aria-label="Invoice week">{yearWeeks.map(w => <option key={w.ending} value={w.ending}>{prettyDate(w.starting)} – {prettyDate(w.ending)}{w.ending === current ? " (this week)" : ""}</option>)}</select><ChevronDown size={16} aria-hidden /></label>
    </div>
    <div className="weekly-invoice-summary">
      <span><strong>{week.count}</strong> billed reel{week.count === 1 ? "" : "s"}</span>
      <span><strong>{formatINR(week.billed)}</strong> to invoice</span>
      {week.reviewCount > 0 && <span className="muted">{week.reviewCount} awaiting a price (not included)</span>}
    </div>
    {weekly
      ? <div className="weekly-invoice-done"><CheckCircle2 size={18} aria-hidden /><span>Invoiced as <strong>{weekly.number}</strong> · {payStateLabel[weekly.state]}</span><a className="button secondary" href={`/api/invoices/${weekly.id}/pdf`}><Download size={16} aria-hidden /> {weekly.number}.pdf</a></div>
      : <form action={generateInvoice} className="weekly-invoice-go">
          <input type="hidden" name="kind" value="weekly" /><input type="hidden" name="date" value={week.starting} />
          <input name="notes" maxLength={1000} placeholder="Note on the invoice (optional)" aria-label="Note on the invoice" />
          <Submit pending="Generating…" className="weekly-invoice-button"><FileText size={16} aria-hidden /> Generate weekly invoice</Submit>
          {dailies.length > 0 && <small className="muted">Replaces daily invoice{dailies.length === 1 ? "" : "s"} {dailies.map(d => d.number).join(", ")} for this week; payments on {dailies.length === 1 ? "it" : "them"} carry over.</small>}
        </form>}
  </div>;
}
/** Daily invoice: reels delivered on one day. Secondary to the weekly invoice. */
function TodayInvoice({ today, todayCount, todayBilled, invoices }: { today: string; todayCount: number; todayBilled: number; invoices: AdminInvoice[] }) {
  const onDay = covering(invoices, today, today)[0];
  return <div className="quick-invoice">
    <CalendarDays size={22} aria-hidden />
    <span><strong>Today&apos;s invoice</strong><small>{prettyDate(today)} · {todayCount} reel{todayCount === 1 ? "" : "s"} delivered today · {formatINR(todayBilled)}</small></span>
    {onDay
      ? <a className="button secondary" href={`/api/invoices/${onDay.id}/pdf`} title={`Already on ${onDay.number}`}><Download size={16} aria-hidden /> {onDay.number}</a>
      : <form action={generateInvoice}><input type="hidden" name="kind" value="daily" /><input type="hidden" name="date" value={today} /><Submit variant="secondary" pending="Generating…"><FileText size={16} aria-hidden /> Generate</Submit></form>}
  </div>;
}
function InvoiceRow({ inv }: { inv: AdminInvoice }) {
  const [amount, setAmount] = useState(String(inv.balance));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return <details className={`invoice-item invoice-${inv.state}`}>
    <summary>
      <span className="invoice-icon"><FileText size={20} aria-hidden /></span>
      <span className="invoice-main"><strong>{inv.number}</strong><small>{inv.kind === "weekly" ? "Weekly" : "Daily"} · {periodLabel(inv.kind, inv.period_start, inv.period_end, prettyDate)} · {inv.item_count} reel{inv.item_count === 1 ? "" : "s"} · issued {prettyDate(inv.issue_date)}</small></span>
      <span className="invoice-amounts"><strong>{formatINR(inv.total)}</strong><small>{inv.state === "paid" && inv.paidOn ? `Paid ${prettyDate(inv.paidOn)}` : inv.state === "void" ? (inv.replacedBy ? `Replaced by ${inv.replacedBy}` : "Void") : inv.balance > 0 ? `${formatINR(inv.balance)} due` : "Settled"}</small></span>
      <Pill tone={tone[inv.state]}>{payStateLabel[inv.state]}</Pill>
    </summary>
    <div className="invoice-pane">
      <div className="invoice-actions">
        <a className="button primary" href={`/api/invoices/${inv.id}/pdf`}><Download size={16} aria-hidden /> Download PDF</a>
        <a className="button secondary" href={`/api/invoices/${inv.id}/pdf?inline=1`} target="_blank" rel="noopener noreferrer"><Eye size={16} aria-hidden /> Preview</a>
      </div>
      {inv.replacedBy && <p className="mini-note replaced-note">Replaced by weekly invoice {inv.replacedBy}.</p>}
      <p className="muted mini-note">Issued {prettyDate(inv.issue_date)} · due {prettyDate(inv.due_date)}{inv.paid > 0 ? ` · ${formatINR(inv.paid)} paid` : ""}{inv.notes ? ` · Note: ${inv.notes}` : ""}</p>
      {inv.payments.length > 0 && <ul className="invoice-payments">{inv.payments.map(p => <li key={p.id}><CheckCircle2 size={15} aria-hidden /> {formatINR(p.amount)} on {prettyDate(p.paid_on)}{p.method ? ` · ${p.method}` : ""}</li>)}</ul>}
      {inv.state !== "void" && inv.balance > 0 && <form action={recordInvoicePayment} className="edit-grid invoice-pay-form">
        <input type="hidden" name="id" value={inv.id} />
        <div className="eyebrow wide"><Wallet size={13} aria-hidden /> RECORD PAYMENT THROUGH THIS INVOICE</div>
        <div className="field"><label htmlFor={`a-${inv.id}`}>Amount received (₹)</label><input id={`a-${inv.id}`} name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" max={inv.balance} value={amount} onChange={e => setAmount(e.target.value)} required /></div>
        <div className="field"><label htmlFor={`d-${inv.id}`}>Date received</label><input id={`d-${inv.id}`} name="paid_on" type="date" defaultValue={today} required /></div>
        <div className="field"><label htmlFor={`m-${inv.id}`}>Method <span className="optional">optional</span></label><select id={`m-${inv.id}`} name="method" defaultValue="UPI"><option value="">Not specified</option>{paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
        <div className="field"><label htmlFor={`r-${inv.id}`}>Reference <span className="optional">optional, private</span></label><input id={`r-${inv.id}`} name="reference" maxLength={120} placeholder="UPI / bank ref" /></div>
        <div className="wide edit-footer"><span className="muted mini-note">Counts for the week of {prettyDate(inv.period_end)} and updates the client view.</span><Submit pending="Saving…"><CheckCircle2 size={16} aria-hidden /> {Number(amount) >= inv.balance ? "Mark as paid" : "Record part payment"}</Submit></div>
      </form>}
      {inv.state !== "void" && inv.payments.length === 0 && <form action={voidInvoice} className="delete-row" onSubmit={confirmSubmit(`Void ${inv.number}? It stays in your records as void (its number isn't reused) and you can create a new invoice for this period.`)}>
        <input type="hidden" name="id" value={inv.id} />
        <span className="muted mini-note">Made a mistake? Void it and generate a new one.</span>
        <Submit variant="danger" pending="Voiding…"><XCircle size={16} aria-hidden /> Void invoice</Submit>
      </form>}
      {inv.state === "void" && inv.payments.length === 0 && <form action={deleteVoidInvoice} className="delete-row" onSubmit={confirmSubmit(`Delete ${inv.number} completely? Only do this if you never sent it to the client.`)}>
        <input type="hidden" name="id" value={inv.id} />
        <span className="muted mini-note">Never sent it (e.g. a test)? Delete it. If it&apos;s the latest invoice, its number will be used again.</span>
        <Submit variant="danger" pending="Deleting…"><Trash2 size={16} aria-hidden /> Delete invoice</Submit>
      </form>}
    </div>
  </details>;
}
function ProfileForm({ profile }: { profile: InvoiceProfile }) {
  const f = (name: keyof InvoiceProfile, label: string, opts: { area?: boolean; type?: string; placeholder?: string; wide?: boolean } = {}) =>
    <div className={`field ${opts.wide || opts.area ? "wide" : ""}`}><label htmlFor={`ip-${name}`}>{label}</label>
      {opts.area ? <textarea id={`ip-${name}`} name={name} rows={2} defaultValue={String(profile[name] ?? "")} placeholder={opts.placeholder} />
        : <input id={`ip-${name}`} name={name} type={opts.type || "text"} defaultValue={String(profile[name] ?? "")} placeholder={opts.placeholder} />}</div>;
  return <details className="invoice-profile"><summary><Settings2 size={15} aria-hidden /> Invoice details (your business, payment details, client)</summary>
    <form action={saveInvoiceDetails} className="edit-grid">
      <div className="eyebrow wide">INVOICE NUMBER</div>
      {f("invoice_prefix", "Number prefix (CS-MS gives CS-MS-01, CS-MS-02…)")}
      <div className="eyebrow wide">FROM</div>
      {f("business_name", "Business name")}{f("owner_name", "Your name")}
      {f("email", "Email", { type: "email" })}{f("phone", "Phone", { type: "tel" })}
      {f("address", "Address", { area: true })}
      <div className="eyebrow wide">PAYMENT DETAILS (printed on the invoice)</div>
      {f("upi_id", "UPI ID", { placeholder: "name@bank" })}{f("payment_terms_days", "Payment due (days after issue)", { type: "number" })}
      {f("bank_details", "Bank details", { area: true, placeholder: "Account name, number, IFSC" })}
      <div className="eyebrow wide">BILL TO</div>
      {f("client_name", "Client name")}{f("client_handle", "Handle")}
      {f("client_email", "Client email", { type: "email", wide: true })}
      {f("client_address", "Client address", { area: true })}
      {f("footer_note", "Thank-you note", { area: true })}
      <div className="wide align-end"><Submit pending="Saving…">Save details</Submit></div>
    </form>
  </details>;
}

export function InvoicesPanel({ invoices: incoming, profile, today, ready, weeks, todayCount, todayBilled }: { invoices: AdminInvoice[]; profile: InvoiceProfile; today: string; ready: boolean; weeks: WeekSummary[]; todayCount: number; todayBilled: number }) {
  const [shown, setShown] = useState(10);
  const [tab, setTab] = useState<InvoiceHistoryTab>("recent");
  // Newest generated first, whatever order the data arrives in.
  const invoices = useMemo(() => [...incoming].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.number.localeCompare(a.number)), [incoming]);
  const due = invoices.filter(i => i.state === "unpaid" || i.state === "partial").reduce((s, i) => s + i.balance, 0);
  const live = invoices.filter(i => i.state !== "void");
  const invoiced = live.reduce((s, i) => s + i.total, 0), paidTotal = live.reduce((s, i) => s + i.paid, 0);
  const count = (t: InvoiceHistoryTab) => t === "recent" ? invoices.length : invoices.filter(i => historyTab(i.state) === t).length;
  // Recent: every invoice, newest generated first. Paid: most recently paid first.
  const list = tab === "recent" ? invoices
    : invoices.filter(i => historyTab(i.state) === tab).sort((a, b) => tab === "paid" ? (b.paidOn || "").localeCompare(a.paidOn || "") || b.created_at.localeCompare(a.created_at) : b.created_at.localeCompare(a.created_at));
  const last = invoices[0];
  const tabs: [InvoiceHistoryTab, string][] = [["recent", "Recent"], ["unpaid", "Unpaid"], ["paid", "Paid"], ["void", "Void"]];
  return <section className="surface invoices-panel" id="invoices">
    <div className="section-top"><SectionHeading eyebrow="BILLING" title="Invoices" description="PDF invoices (no GST), weekly by default. Download and send them to Mohit; record payments against them here." />{due > 0 && <Pill tone="orange">{formatINR(due)} due</Pill>}</div>
    {!ready && <div className="small-alert" role="alert">Run <code>sql/migrate_v1_5.sql</code> in the Supabase SQL Editor to enable invoices.</div>}
    <WeeklyInvoice weeks={weeks} today={today} invoices={invoices} />
    <TodayInvoice today={today} todayCount={todayCount} todayBilled={todayBilled} invoices={invoices} />
    <details className="invoice-custom"><summary><CalendarDays size={15} aria-hidden /> Invoice another day</summary>
      <form action={generateInvoice} className="edit-grid">
        <input type="hidden" name="kind" value="daily" />
        <div className="field"><label htmlFor="inv-date">Date</label><input id="inv-date" name="date" type="date" defaultValue={today} max={today} required /></div>
        <div className="field wide"><label htmlFor="inv-notes">Note on the invoice <span className="optional">optional</span></label><input id="inv-notes" name="notes" maxLength={1000} placeholder="e.g. Includes the revision requested on 29 Oct" /></div>
        <div className="wide align-end"><Submit pending="Generating…"><FileText size={16} aria-hidden /> Generate invoice</Submit></div>
      </form>
    </details>
    {invoices.length > 0 && <div className="invoice-history-head">
      <div className="eyebrow">INVOICE HISTORY</div>
      <div className="invoice-stats">
        <span><small>Invoices generated</small><strong>{live.length}</strong></span>
        <span><small>Total invoiced</small><strong>{formatINR(invoiced)}</strong></span>
        <span><small>Paid</small><strong className="green-text">{formatINR(paidTotal)}</strong></span>
        <span><small>Outstanding</small><strong>{formatINR(due)}</strong></span>
      </div>
      {last && <p className="muted mini-note">Last generated: <strong>{last.number}</strong> on {prettyDate(last.issue_date)} ({last.kind === "weekly" ? "week" : "day"} {periodLabel(last.kind, last.period_start, last.period_end, prettyDate)}) · {payStateLabel[last.state]}</p>}
      <div className="invoice-tabs" role="tablist" aria-label="Invoice history">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`invoice-tab ${tab === id ? "active" : ""}`} onClick={() => { setTab(id); setShown(10); }}>{label} <span>{count(id)}</span></button>)}</div>
    </div>}
    {invoices.length ? (list.length ? <div className="invoice-list">{list.slice(0, shown).map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
      {list.length > shown && <button type="button" className="button secondary load-more-payments" onClick={() => setShown(n => n + 20)}>Show more ({list.length - shown} remaining)</button>}</div>
      : <p className="activity-empty">{tab === "paid" ? "No invoices fully paid yet." : tab === "unpaid" ? "Nothing outstanding. Every invoice is paid." : "No void invoices."}</p>)
      : <Empty title="No invoices yet" description="Choose a week above and generate its invoice. Only delivered, priced reels are included." icon={<FileText />} />}
    <ProfileForm profile={profile} />
  </section>;
}
