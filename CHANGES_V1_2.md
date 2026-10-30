# CrazifiedEdits V1.2 — Google Drive + 2026–2030 Weekly Ledger + Mobile

- Replaced Microsoft OneDrive sign-in, API routes and sync with Google OAuth 2.0 + Google Drive v3 metadata-only folder scanning.
- Nested folder support, Google Drive folder URL/ID validation, encrypted refresh tokens, batch deduplicated imports, and manual review before billing.
- Existing Supabase database migration provided in `sql/migrate_v1_2_google_drive.sql`; legacy OneDrive reel/payment history retained.
- Every Monday–Sunday week from Jan 2026 through Dec 2030 generated automatically, including empty future weeks. Year/week selectors, current-week shortcut and previous/next navigation.
- New touch-friendly reel cards on screens <=760px; iPhone-safe inputs, native date and week controls, safe-area padding, flexible charts and truncation/overflow protection.
- Admin inventory limits initial rendered items to 80 and adds Load More.
- Public dashboard now shows an explicit service-unavailable warning (not false zero totals) if Supabase cannot be reached.
- New 2030 weekly-calendar and Google Drive folder-validation tests; 12 offline tests.
- Updated `preview.html` with an interactive year/week demo, `README.md`, `START_HERE_WINDOWS.txt`, and `.env.example`.

**Not verified here:** Full Next.js install/build or live Google OAuth (dependencies/network and credentials unavailable). Safari browser/device checks must be done on a real iPhone.
