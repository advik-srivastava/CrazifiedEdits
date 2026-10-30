# CrazifiedEdits V1.3

**Database:** run `sql/migrate_v1_3.sql` once (additive, transactional, re-runnable; existing reels and payments are untouched).
**Environment:** no new variables. `ADMIN_EMAIL` may now list several emails separated by commas.
**Hosting:** the Drive sync cron now runs every 15 minutes, which needs Vercel Pro (Hobby allows daily crons only and is non-commercial).

## Fixed
- **Production build failed** in V1.2.1 (`next build` type errors from `@supabase/ssr` 0.6). Upgraded to 0.12 and added `package-lock.json` so Vercel builds are reproducible.
- Sync could overwrite an admin's edit made while a sync was running. Existing rows now get a metadata-only update.
- Two syncs (cron + Sync now) could run at once. Now a database lock lets only one run.
- A Drive file replaced after delivery could change a reel's duration and therefore its bill. Duration is now locked after review.
- The 404 page sent visitors to the login screen. It now links to the client dashboard.
- Signing in with a non-admin account silently bounced back to login. It now explains why.

## Added
- **Today & Yesterday** (IST): uploaded, delivered, billed amount and pending review, with upload date kept separate from delivery date. Rolls over at midnight IST and refreshes from the database every minute (no extra Google API calls).
- **All-time totals:** reels delivered, billed, received, outstanding.
- **Pricing review** for reels over 60 s or of unknown length, plus a per-reel **Confirmed price**.
- **Week payment status:** No charges / Unpaid / Partially paid / Paid, with credit for overpayment.
- **Last synced** status on the client dashboard; **Sync history** log in admin.
- **Mark delivered today** one-tap action; **Not a deliverable** to cancel an upload.
- **Possible re-upload** warning (e.g. "Copy of …", "(1)") to prevent double charging.
- Files removed from the Drive folder are flagged, never deleted.
- **Payment correction** (edit) and payment method.
- Offline banner; skip link; 44 × 44 px touch targets on phones; compact mobile hero so totals are visible without scrolling.
- ESLint, `npm run verify`, 37 unit tests, real-Postgres migration test, test-only mock for layout checks.

## Privacy
- The public page no longer receives internal database IDs. Payment method and reference are never sent to it. Pending uploads appear only as counts.
