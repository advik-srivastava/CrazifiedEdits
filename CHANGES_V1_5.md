# CrazifiedEdits V1.5: invoices

**Database:** run `sql/migrate_v1_5.sql` once in the Supabase SQL Editor (after V1.4). Additive and re-runnable.
**Environment:** no new variables.

## Invoices (admin)
- **This week's invoice** and **Today's invoice** buttons, plus any other week (Monday–Sunday) or day.
- Proper A4 PDF, no GST: your branding, invoice number (`CE-2026-0001`…), issue and due dates, billed by / billed to, one line per reel (date, length, amount), subtotal, "GST: Not charged", total, paid and balance due, your UPI/bank details, notes, page numbers. Long weeks run onto extra pages. A PAID/VOID badge appears once settled or voided.
- Only delivered, priced reels are included. A period can't be invoiced twice (overlapping day/week is refused); void an invoice to redo it.
- Invoices are snapshots, so sent invoices never change when reels are edited later.
- **Invoice details** form for your business, payment details and the client's billing details.

## Paid through invoice
- **Record payment through this invoice**: full ("Mark as paid") or part payments, with date, method and a private reference. It's recorded as a payment for the invoice's billing week, so weekly balances and the client view update immediately.
- Homepage: new **Invoices** list for the client: number, period, due date, total, paid, status (Unpaid / Partially paid / Paid).

## Tests
65 unit tests (periods, line selection, numbering, overlap, paid status, PDF rendering incl. multi-page and emoji titles) and Postgres checks for the new table.
