# CrazifiedEdits V1.7: reels counted in an earlier week, revised versions, faster pages

**Database:** run `sql/migrate_v1_7.sql` once in the Supabase SQL Editor (after V1.6). Re-runnable; nothing is deleted.

## Changes delivered after the week ended
- **Count in last week** (one tap) or **Counts in billing week** (delivery week or up to 4 weeks earlier) on any delivered reel. Weekly totals, balances and weekly invoices follow the billing week; Today/Yesterday keep the real delivery date. The weekly log shows *counted in this week* on moved reels. Warns if the target week is already invoiced.
- **Revised version of an earlier reel**: the revision counts in the original's week and the original is removed from billing (restorable), so the client is charged once.
- Re-upload detection recognises `v2`, `final`, `revised`, `changes`, `Copy of…` and `(1)` file names, so auto-delivery holds them for review.

## Optimisation (measured on the same sample data)
| | Before | After |
|---|---|---|
| Client homepage HTML | 137 KB | 95 KB (−30%) |
| Admin page HTML | 476 KB | 209 KB (−56%) |
| Admin page server render | 0.32 s | 0.17 s |
| Fonts | 10 files + render-blocking CSS from Google | 7 self-hosted, subset files (~15 KB each), no third-party request |

- Pages send only weeks with activity; the browser rebuilds the empty weeks (all 2026–2030 weeks stay selectable).
- Admin edit forms (reels, payments, invoices) are built only when opened.
- Panels receive only the fields they use; the admin page makes 3 fewer database queries per load.
- Shared form helpers in `components/forms.tsx` instead of three copies.
