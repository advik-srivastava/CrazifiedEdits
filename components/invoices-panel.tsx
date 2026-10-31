"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarDays, CalendarRange, CheckCircle2, Download, Eye, FileText, Settings2, Wallet, XCircle } from "lucide-react";
import type { AdminInvoice } from "@/lib/invoices-server";
import { invoicePeriod, payStateLabel, periodLabel, periodsOverlap, type InvoiceProfile } from "@/lib/invoices";
import { formatINR, prettyDate } from "@/lib/billing";
import { paymentMethods } from "@/lib/validation";
import { generateInvoice, recordInvoicePayment, saveInvoiceDetails, voidInvoice } from "@/app/admin/actions";
import { Empty, Pill, SectionHeading } from "./ui";

const tone = { unpaid: "red", partial: "orange", paid: "green", void: "neutral" } as const;
function Submit({ children, variant = "primary", pending = "Working…", className = "" }: { children: React.ReactNode; variant?: string; pending?: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return <button type="submit" className={`button ${variant} ${className}`} disabled={busy} aria-busy={busy}>{busy ? pending : children}</button>;
}
const confirmSubmit = (msg: string) => (e: React.FormEvent<HTMLFormElement>) => { if (!confirm(msg)) e.preventDefault(); };

function QuickInvoice({ kind, today, invoices }: { kind: "weekly" | "daily"; today: string; invoices: AdminInvoice[] }) {
  const period = invoicePeriod(kind, today);
  const existing = invoices.find(i => i.status === "issued" && periodsOverlap(period, { start: i.period_start, end: i.period_end }));
  const label = kind === "weekly" ? "This week's invoice" : "Today's invoice";
  const sub = periodLabel(kind, period.start, period.end, prettyDate);
  const Icon = kind === "weekly" ? CalendarRange : CalendarDays;
  if (existing) return <div className="quick-invoice done">
    <Icon size={22} aria-hidden /><span><strong>{label}</strong><small>{sub} · {existing.number} already covers this</small></span>
    <a className="button secondary" href={`/api/invoices/${existing.id}/pdf`}><Download size={16} aria-hidden /> PDF</a>
  </div>;
  return <form action={generateInvoice} className="quick-invoice">
    <input type="hidden" name="kind" value={kind} /><input type="hidden" name="date" value={today} />
    <Icon size={22} aria-hidden /><span><strong>{label}</strong><small>{sub}</small></span>
    <Submit pending="Generating…"><FileText size={16} aria-hidden /> Generate</Submit>
  </form>;
}
function InvoiceRow({ inv }: { inv: AdminInvoice }) {
  const [amount, setAmount] = useState(String(inv.balance));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return <details className={`invoice-item invoice-${inv.state}`}>
    <summary>
      <span className="invoice-icon"><FileText size={20} aria-hidden /></span>
      <span className="invoice-main"><strong>{inv.number}</strong><small>{inv.kind === "weekly" ? "Weekly" : "Daily"} · {periodLabel(inv.kind, inv.period_start, inv.period_end, prettyDate)} · {inv.item_count} reel{inv.item_count === 1 ? "" : "s"}</small></span>
      <span className="invoice-amounts"><strong>{formatINR(inv.total)}</strong><small>{inv.state === "void" ? "Void" : inv.balance > 0 ? `${formatINR(inv.balance)} due` : "Settled"}</small></span>
      <Pill tone={tone[inv.state]}>{payStateLabel[inv.state]}</Pill>
    </summary>
    <div className="invoice-pane">
      <div className="invoice-actions">
        <a className="button primary" href={`/api/invoices/${inv.id}/pdf`}><Download size={16} aria-hidden /> Download PDF</a>
        <a className="button secondary" href={`/api/invoices/${inv.id}/pdf?inline=1`} target="_blank" rel="noopener noreferrer"><Eye size={16} aria-hidden /> Preview</a>
      </div>
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

export function InvoicesPanel({ invoices, profile, today, ready }: { invoices: AdminInvoice[]; profile: InvoiceProfile; today: string; ready: boolean }) {
  const [shown, setShown] = useState(10);
  const due = invoices.filter(i => i.state === "unpaid" || i.state === "partial").reduce((s, i) => s + i.balance, 0);
  return <section className="surface invoices-panel" id="invoices">
    <div className="section-top"><SectionHeading eyebrow="BILLING" title="Invoices" description="PDF invoices (no GST) for a billing week or a single day. Download and send them to Mohit; record payments against them here." />{due > 0 && <Pill tone="orange">{formatINR(due)} due</Pill>}</div>
    {!ready && <div className="small-alert" role="alert">Run <code>sql/migrate_v1_5.sql</code> in the Supabase SQL Editor to enable invoices.</div>}
    <div className="quick-invoices"><QuickInvoice kind="weekly" today={today} invoices={invoices} /><QuickInvoice kind="daily" today={today} invoices={invoices} /></div>
    <details className="invoice-custom"><summary><CalendarDays size={15} aria-hidden /> Invoice another week or day</summary>
      <form action={generateInvoice} className="edit-grid">
        <div className="field"><label htmlFor="inv-kind">Type</label><select id="inv-kind" name="kind" defaultValue="weekly"><option value="weekly">Weekly (Monday–Sunday containing the date)</option><option value="daily">Daily (that date only)</option></select></div>
        <div className="field"><label htmlFor="inv-date">Date</label><input id="inv-date" name="date" type="date" defaultValue={today} max={today} required /></div>
        <div className="field wide"><label htmlFor="inv-notes">Note on the invoice <span className="optional">optional</span></label><input id="inv-notes" name="notes" maxLength={1000} placeholder="e.g. Includes the revision requested on 29 Oct" /></div>
        <div className="wide align-end"><Submit pending="Generating…"><FileText size={16} aria-hidden /> Generate invoice</Submit></div>
      </form>
    </details>
    {invoices.length ? <div className="invoice-list">{invoices.slice(0, shown).map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
      {invoices.length > shown && <button type="button" className="button secondary load-more-payments" onClick={() => setShown(n => n + 20)}>Show more ({invoices.length - shown} remaining)</button>}</div>
      : <Empty title="No invoices yet" description="Generate this week's or today's invoice above. Only delivered, priced reels are included." icon={<FileText />} />}
    <ProfileForm profile={profile} />
  </section>;
}
