# CrazifiedEdits V1.4

**Database:** run `sql/migrate_v1_4.sql` once in the Supabase SQL Editor, after `migrate_v1_3.sql`. It is additive and re-runnable, and it also creates the private `payment-proofs` storage bucket.
**Environment:** no new variables. Instant sync uses the `https://` address in `GOOGLE_REDIRECT_URI`.

## Instant Google Drive sync
- Google Drive now notifies CrazifiedEdits of changes (Drive "changes.watch" push notifications) at `/api/gdrive/webhook`. A new upload or a deletion appears within about 30 seconds.
- Notifications are verified with a secret channel token; bursts collapse into one sync (20 s minimum gap plus the sync lock).
- The channel lasts up to 7 days and is renewed automatically by every sync (including the daily cron). Admin shows whether instant sync is on, with a "Turn on now" button.
- Still in place as fallbacks: sync on dashboard visits (if over 15 minutes old), the daily cron, and **Sync now**.

## Auto-delivery (on by default, switchable in admin → Google Drive → Automation)
- New uploads are marked **Delivered** on their upload date (India time) and billed by the usual rule: ₹600 up to 60 s; longer reels still need a confirmed price.
- Safeguards: only files uploaded **after** auto-delivery was switched on (no backlog billing on first sync); likely re-uploads ("Copy of…", "(1)", same title as a live reel) stay in Pending review.

## Auto-removal (on by default, switchable)
- When a video is deleted, trashed or moved out of the folder, its reel is taken off the delivery log and its charge is removed from that week. Payments already received are not touched (a week can show a credit).
- The previous status is kept: if the file comes back, the reel is restored automatically.
- Safeguards: only reels known to belong to the monitored folder are affected (changing folders never removes old reels), and if one sync would remove more than half the folder (and more than 5 reels) nothing is removed and admin gets a warning; that usually means a wrong folder or lost access, not deletions.

## Client payment reports
- Homepage: **Report a payment** with week, amount, date, method, optional UPI/transaction ID, note and a screenshot (compressed on the phone before upload).
- The week shows **"Payment reported · awaiting confirmation"** to the client; it does **not** change balances until you confirm it.
- Admin: **Payments reported by Mohit**, with the screenshot (private storage, 10-minute links), **Confirm received** (records the payment; amount editable) or **Not received**.
- Screenshots, references and notes are never sent to the public page. Spam protection: same-site check, hidden honeypot field, 5 reports per hour per visitor, 30 pending at most, and screenshots checked by file content (JPG/PNG/WebP, 4 MB).

## Tests
48 unit tests (auto-delivery window and re-upload hold, restore, mass-removal guard, report validation, image checks, reported payments never counted) and the Postgres migration test (V1.4 additive, constraints, RLS).
