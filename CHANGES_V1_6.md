# CrazifiedEdits V1.6: weekly invoices first, CS-MS numbering

**Database:** run `sql/migrate_v1_6.sql` once in the Supabase SQL Editor (after V1.5). Re-runnable; nothing is deleted.

- **Weekly invoice is the main option**, with the same Year / Week selector as the weekly reel log, a preview of billed reels and amount, and a **Generate weekly invoice** button inside the admin weekly log for the week being viewed.
- **Weekly invoices include every billed reel in the week.** Previously a daily invoice inside the week blocked the weekly one. Now the weekly invoice replaces those daily invoices (voided, marked "Replaced by …"); any payments on them move to the weekly invoice, so balances don't change.
- **Today's invoice** shows how many reels were delivered today and the amount before generating.
- **Numbers `CS-MS-01`, `CS-MS-02`…** (Crazified Studios → Mohit Sharma); the PDF file is named `CS-MS-01.pdf`. Existing `CE-2026-…` invoices are renumbered into the series by the migration. The prefix is editable in Invoice details; the client name now defaults to Mohit Sharma.
- Void invoices that were never sent can be deleted (frees the latest number).
- Clearer message when a period has nothing to invoice (e.g. reels still pending review).
- **Invoice history**: totals, last generated invoice, and Recent / Unpaid / Paid / Void tabs in admin; paid date on every paid invoice (admin and client). All invoices are kept; the client page shows the latest 8 with older ones expandable.
