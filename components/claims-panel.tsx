"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, ImageOff, Inbox, XCircle, ZoomIn } from "lucide-react";
import type { AdminClaimView } from "@/lib/models";
import { formatINR, prettyDate, prettyDateTime, shiftISODate } from "@/lib/billing";
import { confirmClaim, rejectClaim } from "@/app/admin/actions";
import { Pill, SectionHeading } from "./ui";

function Submit({ children, variant, label }: { children: React.ReactNode; variant: "primary" | "subtle"; label: string }) {
  const { pending } = useFormStatus();
  return <button className={`button ${variant}`} type="submit" disabled={pending} aria-busy={pending}>{pending ? label : children}</button>;
}
const tone = { pending: "orange", confirmed: "green", rejected: "neutral" } as const;
const label = { pending: "Awaiting your review", confirmed: "Confirmed", rejected: "Not received" } as const;

/** Payments the client reported from the homepage. Screenshots are private and only shown here. */
export function ClaimsPanel({ claims }: { claims: AdminClaimView[] }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const pending = claims.filter(c => c.status === "pending");
  const reviewed = claims.filter(c => c.status !== "pending").slice(0, 6);
  return <section className="surface claims-panel" id="claims">
    <div className="section-top"><SectionHeading eyebrow="CLIENT PAYMENT REPORTS" title="Payments reported by Mohit" description="Check each screenshot against your bank/UPI app, then confirm it to record the payment." /><Pill tone={pending.length ? "orange" : "green"}>{pending.length ? `${pending.length} to review` : "Nothing to review"}</Pill></div>
    {!pending.length && <div className="no-transactions"><Inbox size={18} aria-hidden /><span>No reports waiting. When Mohit reports a payment from the homepage it appears here.</span></div>}
    <ul className="claims-list">{pending.map(c => <li className="claim-item" key={c.id}>
      <div className="claim-shot">{c.screenshot_url ? <button type="button" className="shot-thumb" onClick={() => setZoom(c.screenshot_url)} aria-label="Enlarge payment screenshot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.screenshot_url} alt={`Payment screenshot, ${formatINR(Number(c.amount))}`} loading="lazy" /><span className="shot-zoom"><ZoomIn size={14} aria-hidden /></span></button>
        : <span className="shot-none"><ImageOff size={20} aria-hidden /><small>No screenshot</small></span>}</div>
      <div className="claim-body">
        <strong className="claim-amount">{formatINR(Number(c.amount))}</strong>
        <small>For week {prettyDate(shiftISODate(c.week_ending, -6))} – {prettyDate(c.week_ending)} · paid {prettyDate(c.paid_on)}{c.method ? ` · ${c.method}` : ""}</small>
        {c.reference && <small>Ref: <span className="mono">{c.reference}</span></small>}
        {c.note && <small>“{c.note}”</small>}
        <small className="muted">Sent {prettyDateTime(c.submitted_at)}</small>
        <div className="claim-actions">
          <form action={confirmClaim} className="claim-confirm"><input type="hidden" name="id" value={c.id} />
            <label className="sr-only" htmlFor={`amt-${c.id}`}>Amount to record</label>
            <input id={`amt-${c.id}`} name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={Number(c.amount)} aria-describedby={`amt-h-${c.id}`} />
            <Submit variant="primary" label="Confirming…"><CheckCircle2 size={16} aria-hidden /> Confirm received</Submit>
            <small id={`amt-h-${c.id}`} className="form-hint">Change the amount if it differs from what arrived.</small>
          </form>
          <form action={rejectClaim} className="claim-reject" onSubmit={e => { if (!confirm("Mark this report as not received? Mohit will see it as not confirmed.")) e.preventDefault(); }}>
            <input type="hidden" name="id" value={c.id} /><input name="review_note" maxLength={300} placeholder="Reason (private, optional)" aria-label="Reason, private" />
            <Submit variant="subtle" label="Saving…"><XCircle size={16} aria-hidden /> Not received</Submit>
          </form>
        </div>
      </div>
    </li>)}</ul>
    {reviewed.length > 0 && <details className="claims-history"><summary>Recently reviewed ({reviewed.length})</summary><ul>{reviewed.map(c => <li key={c.id}><Pill tone={tone[c.status]}>{label[c.status]}</Pill><span>{formatINR(Number(c.amount))} · week ending {prettyDate(c.week_ending)}</span>{c.screenshot_url && <button type="button" className="text-link" onClick={() => setZoom(c.screenshot_url)}>View screenshot</button>}</li>)}</ul></details>}
    {zoom && <div className="shot-modal" role="dialog" aria-modal="true" aria-label="Payment screenshot" onClick={() => setZoom(null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={zoom} alt="Payment screenshot" />
      <button type="button" className="button secondary" onClick={() => setZoom(null)}>Close</button>
    </div>}
  </section>;
}
