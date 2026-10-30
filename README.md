# CrazifiedEdits V1.2.1 · by Crazified Studios

**Google Drive video sync · Individual Monday–Sunday billing weeks through 2030 · iPhone/mobile-first reel log · ₹600 per reel (up to 60 seconds) · Advik admin + Mohit (@OkayMohit) public dashboard.**

The home page (`/`) is **public and read-only**. Advik signs in at `/login` and edits reels/payments at `/admin`. This is a real Next.js/Supabase app; `preview.html` contains **fictional sample data only** and does not access Google Drive or Supabase.

## UPGRADING FROM V1.2 (name-only update)

If you already configured Google Drive and ran the V1.2 Supabase migration, **no SQL change is required**. Just extract this release separately, copy your existing `.env.local` into the new folder, then run `npm install` and `npm run dev`. All existing Supabase reels, payments and Google Drive connection data are preserved.

## UPGRADING your EXISTING V1.1 setup

**You already created a Supabase project and ran `sql/schema.sql` for V1.1. Keep that project: do not delete its tables or run the new initial schema.**

1. Extract this **V1.2 ZIP** into a **new folder**. Back up your old V1.1 folder before changing anything.
2. In Supabase **SQL Editor**, run **`sql/migrate_v1_2_google_drive.sql`**. It changes the `reels.source` constraint to allow `google_drive` and creates a private `google_drive_connection` table. **It does not delete existing reels or payments.** The unused legacy OneDrive connection table remains unless you explicitly remove it later.
3. Copy your V1.1 **`.env.local`** into the new V1.2 folder (this file isn't in either ZIP). **Keep all existing `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL` and `CRON_SECRET` values.** Do not create a new Supabase project or admin user.
4. **Add** the following new variables to your existing `.env.local`:

   ```env
   GOOGLE_TOKEN_ENCRYPTION_KEY=YOUR_64_HEX_ENCRYPTION_KEY
   GOOGLE_CLIENT_ID=YOUR_GOOGLE_WEB_OAUTH_CLIENT_ID
   GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_WEB_OAUTH_CLIENT_SECRET
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/gdrive/callback
   ```

   Generate a new encryption key with `node scripts/generate-secrets.mjs`. **If you prefer to reuse your existing `ONEDRIVE_ENCRYPTION_KEY`**, the server supports that as a fallback; this is optional and does not reconnect OneDrive. Do not paste secret values in chat or screenshots. Old `MICROSOFT_*` environment variables can be removed; the app no longer calls Microsoft Graph.
5. Run `npm install` and `npm run dev` from the new folder; open <http://localhost:3000>. Your existing Supabase login should still work at `/login`.

For a **brand-new** Supabase project, run `sql/schema.sql` instead of the migration; do not run both on the same fresh project.

## GOOGLE DRIVE API / OAUTH SETUP

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a Google Cloud project dedicated to Crazified Studios.
2. Go to **APIs & Services → Library**, search for **Google Drive API** and **Enable** it.
3. Configure **Google Auth Platform → Branding/Audience/Data Access** (formerly OAuth consent screen). For a personal Gmail account, choose **External**. When the consent screen is in **Testing**, add your own Gmail address as a **Test user**.
4. In **Google Auth Platform → Clients**, click **Create client → Web application**. Name it `CrazifiedEdits Local`.
5. Set the exact **Authorized redirect URI** to:

   `http://localhost:3000/api/gdrive/callback`

6. Copy the generated **Client ID** and **Client secret** to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` inside `.env.local`.
7. The app requests `https://www.googleapis.com/auth/drive.metadata.readonly`, `openid`, `email`, and `profile`. **It reads file metadata/links only; it cannot edit or share your Drive files.** A restricted/sensitive scope may need additional Google verification for public production use.
8. Create a folder in Google Drive, upload/edit your video files there. In Google Drive, right-click the folder → **Share → Copy link**.
9. In CrazifiedEdits `/admin` → **Google Drive → Connect**, authorize your Google account. Paste the folder URL into **Folder to monitor**, click **Save folder** and then **Sync now**. The folder can contain video subfolders.
10. New files appear as **Needs review** and are **not billed** until Advik confirms duration, selects Delivered/Approved/Revision, and chooses the actual delivery date. Automatically discovered file metadata may not yet contain duration; enter it manually if needed.

**Google testing-token caveat:** For an External OAuth app whose publishing status is **Testing**, Google refresh tokens containing Drive scopes generally expire in **7 days**; you may need to reconnect until the consent app is appropriately published/verified. This is a Google limitation, not a CrazifiedEdits bug. [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2).

**Client file permissions:** A Google Drive `webViewLink` doesn't automatically give Mohit permission to open the file. Share the folder or specific file with Mohit's Google account (or configure link access intentionally) using Google's normal sharing UI. You can override a reel's client link in admin. Do not make a folder public unless that exposure is acceptable.

## HOW WEEKLY BILLING WORKS

- Every Monday–Sunday billing period covering **1 Jan 2026 through 31 Dec 2030** is pre-generated **in the app**, even if that week has **zero reels**. The first visible week is 29 Dec 2025–4 Jan 2026; the last is 30 Dec 2030–5 Jan 2031. Those boundary weeks include the dates requested, and no dates are skipped.
- Choose a **year** and a **specific week**, or use **Previous**, **Next** and **Current week** buttons. Weekly logs and payment histories stay separate.
- Each eligible reel earns **₹600**: status Delivered/Approved/Revision, valid delivery date, duration between **1 and 60 seconds** inclusive. New imported draft/cancelled and >60-second files are excluded from billing. No surprise charges on automatic folder scanning.
- **Total billed = eligible reels × ₹600**, **due = billed − received payments**. Record partial payments in `/admin` against an exact Sunday date; the payment form lists all weekly periods through 2030.
- Week records are **computed from dated reels/payments, not 260 separate SQL rows**. This means you can browse future empty weeks without needing a SQL calendar seed.
- Earlier delivered videos (including legacy OneDrive links) remain in the database and in their historical week; Google files sync by unique Google file ID, retaining approvals and delivery dates on re-sync.
- Large video inventories are processed in batches; the admin list initially renders **80 rows** with a Load More button. Large folders may still need multiple sync runs or smaller subfolders to meet hosting request timeouts.

## MOBILE / IPHONE DESIGN

- Responsive 2-column KPI cards, single-column content panels, touch-friendly controls.
- **Mobile video cards** replace the desktop 6-column reel table to avoid sideways scrolling, and long filenames wrap.
- Billing year + week dropdowns use native pickers on iOS; dates and payment week selectors are optimized for mobile.
- Form text uses 16px on mobile to avoid Safari auto-zoom; controls have larger touch targets and safe-area padding for iPhone notches/home indicators.
- CSS supports reduced-motion preferences. Desktop table layout is retained on larger screens.

**Testing note:** Code syntax and billing rules were checked offline, but the full Next.js production build, live OAuth sync and Safari device testing still require npm dependencies and real accounts. No software can be guaranteed glitch-free on every iPhone without device-level testing. Test on your actual iPhone before production.

## RUNNING / DEPLOYING

```powershell
# From the extracted NEW V1.2 project folder
npm install
npm run dev
```

- Public dashboard: <http://localhost:3000>
- Advik login: <http://localhost:3000/login>
- Admin dashboard: <http://localhost:3000/admin>
- Design preview (fictional values): open `preview.html` directly.

For Vercel deployment, use a hosting plan that permits **commercial use** and configure the same environment variables on the server. Register an additional Google OAuth Redirect URI (`https://YOUR-DOMAIN/api/gdrive/callback`) and set `GOOGLE_REDIRECT_URI` in Vercel to match it exactly. Keep `CRON_SECRET` private. `vercel.json` schedules a daily sync at `04:00 UTC` (09:30 IST); automatic scanning is **daily**, not instant. Use Sync now for an immediate scan. Localhost needs manual sync unless you run an external scheduler.

The public homepage has **no client login** by design; anyone who has the site URL can view reel names, links and payment totals. `robots.txt`/noindex is not security. Add a client access gate or secret link before publishing confidential client financial data.

## TROUBLESHOOTING

- **`TypeError: fetch failed` / Unable to load payments:** Your **Node.js server cannot reach Supabase**. Switching to Google Drive does **not** fix a Supabase network/DNS/TLS problem. Check `.env.local` URL and Supabase service-role key, then run `Test-NetConnection YOUR-PROJECT.supabase.co -Port 443` and a Node.js fetch test. Restart `npm run dev` after changing env values.
- **`google_drive_connection` missing:** Run `sql/migrate_v1_2_google_drive.sql` on your existing Supabase project.
- **`redirect_uri_mismatch`:** Copy the exact `GOOGLE_REDIRECT_URI` into Google Cloud OAuth client authorized redirect URIs; localhost port and path must match.
- **`access_denied`:** Add your Google account as a Test user in OAuth consent settings, or resolve organization restrictions.
- **`invalid_grant`:** Expired or revoked Google refresh token; reconnect from admin. Check 7-day Testing token caveat.
- **`403` from Google Drive:** Enable Google Drive API, check scopes and account permission to the folder.
- **Folder URL refused:** The input must be a **Google Drive folder** URL (`https://drive.google.com/drive/folders/...`) or a bare folder ID, **not** a filename/path or individual file link.
- **Video link not visible to Mohit:** Google file sharing permissions are independent of the public ledger.
- **Migrations and database access:** Keep RLS enabled; never expose Supabase service-role key, Google client secret or refresh token in public/browser variables.

## TESTS

```powershell
npm test
npm run typecheck
npm run build
```

This is a starter billing ledger, not a payment processor or certified accounting system. It records payments manually; it does not collect or verify bank transactions.

**Official references:** [Google Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Google file metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Supabase SSR Auth](https://supabase.com/docs/guides/auth/server-side).
