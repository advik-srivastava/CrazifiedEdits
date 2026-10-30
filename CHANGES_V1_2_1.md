# CrazifiedEdits V1.2.1 — software name update

**New product name:** CrazifiedEdits
**Studio/owner:** Crazified Studios (Advik)
**Client:** Mohit (@OkayMohit)

Updated browser title and metadata, public page, admin header, login page, error screens, product wordmark, HTML preview, project package metadata and setup instructions. The original CRAZIFIED studio logo is preserved.

No database or API changes. The Google Drive sync, Supabase authentication, ₹600/reel billing, Monday–Sunday weeks through 2030, iPhone layouts and existing payments/reels remain unchanged.

## To upgrade from V1.2

1. Extract the new ZIP to its own folder.
2. Copy **your existing `.env.local`** into it (don't publish this file).
3. **No new SQL migration is required** if the V1.2 Google Drive migration has already been run. If not, use `sql/migrate_v1_2_google_drive.sql` once.
4. Run `npm install` and `npm run dev`.
5. Open `http://localhost:3000` to see the newly branded client dashboard.

`preview.html` shows example data and is not a live login or dashboard.
