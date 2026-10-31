import { FileText } from "lucide-react";
import type { PublicInvoice } from "@/lib/invoices-server";
import { payStateLabel, periodLabel } from "@/lib/invoices";
import { formatINR, prettyDate } from "@/lib/billing";
import { Pill, SectionHeading } from "./ui";

const tone = { unpaid: "red", partial: "orange", paid: "green", void: "neutral" } as const;

/** Client view: invoices Advik has issued and how much of each is paid. No line items, notes or IDs. */
export function PublicInvoices({ invoices }: { invoices: PublicInvoice[] }) {
  if (!invoices.length) return null;
  return <section className="surface invoices-public" aria-labelledby="invoices-heading">
    <SectionHeading eyebrow="INVOICES" title="Invoices" description="Invoices sent for completed work and their payment status. Payments update here as soon as they're recorded." />
    <ul className="invoice-public-list">{invoices.map(inv => <li key={inv.key}>
      <span className="invoice-icon"><FileText size={18} aria-hidden /></span>
      <span className="invoice-main"><strong>{inv.number}</strong><small>{inv.kind === "weekly" ? "Week" : "Day"}: {periodLabel(inv.kind, inv.period_start, inv.period_end, prettyDate)} · due {prettyDate(inv.due_date)}</small></span>
      <span className="invoice-amounts"><strong>{formatINR(inv.total)}</strong><small>{inv.state === "paid" ? "Paid in full" : inv.paid > 0 ? `${formatINR(inv.paid)} paid · ${formatINR(Math.max(0, inv.total - inv.paid))} due` : "Not paid yet"}</small></span>
      <Pill tone={tone[inv.state]}>{payStateLabel[inv.state]}</Pill>
    </li>)}</ul>
  </section>;
}
