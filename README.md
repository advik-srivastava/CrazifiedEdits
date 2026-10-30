# CrazifiedEdits · by Crazified Studios

Reel delivery log and weekly payment ledger for **Mohit (@OkayMohit)**, edited by **Advik**.
Google Drive sync · Monday–Sunday billing weeks through 2030 · ₹600 per reel up to 60 seconds · mobile-first.

| Route | Who | What |
|---|---|---|
| `/` | Anyone with the URL | Client dashboard: totals, Today/Yesterday, weekly reel log, Drive links, payments, and **Report a payment** (with screenshot) |
| `/login` | Admin | Supabase email + password sign-in |
| `/admin` | Admin only (server-enforced) | Review uploads, prices, payments, confirm client payment reports, Google Drive automation, sync log |

Stack: Next.js 16 (App Router, TypeScript) · Supabase Postgres + Auth · Google Drive API · Vercel.

---

## Billing rules

- **₹600 per reel** that is *delivered* (status Delivered, Approved or Revision, with a delivery date) and **1–60 seconds long** (60 s exactly is billable).
- **Auto-delivery (default on, switchable):** a new Drive upload is marked delivered on its upload date and billed. Uploads from before it was switched on, and likely re-uploads, stay **Pending review**. With it off, every upload waits for you to mark it delivered.
- **Auto-removal (default on, switchable):** a video deleted, trashed or moved out of the folder is taken off the delivery log and its charge removed; it's restored if the file comes back. Recorded payments are never changed.
- **Over 60 s, or unknown length → "Pricing review required."** These reels are listed in the weekly log but excluded from totals until the admin enters a **Confirmed price** for that reel.
- **Billing week** = the Monday–Sunday week containing the delivery date (settled Sunday). Every week from 29 Dec 2025 – 4 Jan 2026 through 30 Dec 2030 – 5 Jan 2031 is selectable, including empty weeks. A week that crosses New Year is filed under the year its Monday falls in (the first week counts as 2026).
- **Weekly billed** = sum of billed reels delivered that week. **Balance due** = weekly billed − payments allocated to that week. Status: *No charges · Unpaid · Partially paid · Paid* (an overpayment shows as a credit).
- **Upload date ≠ delivery date.** Today/Yesterday (India time) count uploads by the Drive file's creation time, and deliveries/billing by delivery date.
- **Stable history:** once a reel is past review its duration is locked against Drive changes; renames update the title of the same record; files removed from Drive are flagged, never deleted. Delivered reels can't be removed with one click; correct them deliberately in Edit.

## Google Drive sync

- OAuth 2.0 with PKCE; scopes are the minimum needed: `drive.metadata.readonly`, `openid`, `email`, `profile`. The app can't read video contents, edit or share files.
- Refresh token is stored **encrypted (AES-256-GCM)** server-side in Supabase.
- One record per Drive file ID (unique constraint). New files are inserted; existing ones get a metadata-only update, so sync can never overwrite status, delivery date, notes, links or prices.
- Imports file name, Drive ID, view link, MIME type, created/modified time and duration (when Drive has processed it; it fills in on a later sync).
- **Instant sync:** Google Drive notifies `/api/gdrive/webhook` when anything changes, so uploads and deletions show within about 30 seconds. Needs the live `https://` site (set in `GOOGLE_REDIRECT_URI`); the channel renews itself and admin shows its status. `robots.txt` lets only Google's notifier (APIs-Google) reach that URL.
- **Fallback schedule (works on Vercel Hobby):** whenever the client or admin dashboard is opened and the last sync is over 15 minutes old, a sync runs in the background after the page loads (so the page is never slowed). A daily Vercel Cron (`vercel.json`, 02:30 IST) is the fallback, plus **Sync now** in admin. A database lock prevents overlapping runs; each run is recorded in `sync_events` (*Sync history*).
- Retries Google 429/5xx with backoff; clear messages for expired authorization, missing permissions and wrong folder links.
- Likely re-uploads (e.g. "Copy of …", "(1)") are flagged in admin before they can be billed twice.

## Client payment reports

Mohit taps **Report a payment** on the homepage, enters the week, amount, date and (optionally) a UPI/transaction ID and screenshot. The week then shows *Payment reported · awaiting confirmation*; balances don't change. In admin, **Payments reported by Mohit** shows the screenshot. **Confirm received** records it as a payment (you can adjust the amount), and **Not received** marks it unconfirmed. Screenshots live in a private Supabase Storage bucket (`payment-proofs`) and are only shown to the admin through 10-minute links.

## Privacy

- All tables have RLS on with **no public policies**. Only the server (service-role key) reads or writes.
- The public page gets a filtered projection: delivered reels (title, date, duration, amount, Drive link) and payment amounts/dates. **Never sent:** notes, payment method/reference, database or Drive IDs, pending uploads (counts only), tokens, account email, folder ID. A test asserts this (`tests/public-ledger.test.ts`).
- `robots.txt` and `noindex` keep it out of search engines. **That is not access control:** anyone with the URL can view the ledger. That is the agreed design. If you later want it private, add a client login or secret link.
- Google Drive files keep their own sharing settings. Share the folder with Mohit's Google account so "Open file" works for him.

---

## Setup

### 1. Supabase

1. Create a project (or keep your existing one; **don't delete its tables**).
2. In **SQL Editor**:
   - **New project:** run `sql/schema.sql`, then `sql/migrate_v1_3.sql`, then `sql/migrate_v1_4.sql`.
   - **Existing V1.1:** run `sql/migrate_v1_2_google_drive.sql`, then `sql/migrate_v1_3.sql`, then `sql/migrate_v1_4.sql`.
   - **Existing V1.2 / V1.2.1:** run `sql/migrate_v1_3.sql`, then `sql/migrate_v1_4.sql`.
   - **Already on V1.3:** run `sql/migrate_v1_4.sql`.

   Migrations are additive, transactional and safe to re-run; they never delete rows.
3. **Authentication → Users → Add user**: create the admin account with email + password. Put that email in `ADMIN_EMAIL`. Disable public sign-ups (Authentication → Sign In / Providers → turn off "Allow new users to sign up"). Only `ADMIN_EMAIL` accounts can use `/admin` either way.
4. **Project Settings → API**: copy the URL, anon/publishable key and service-role key.

### 2. Google Cloud

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and **enable the Google Drive API**.
2. **Google Auth Platform**: set up branding and audience (External for a personal Gmail). While in *Testing*, add your Google account as a test user.
3. **Clients → Create client → Web application**. Authorized redirect URIs (exact match):
   - `http://localhost:3000/api/gdrive/callback` (local)
   - `https://YOUR-DOMAIN/api/gdrive/callback` (production)
4. Copy the Client ID and secret.

> **Testing-mode caveat:** while the consent screen is in *Testing*, Google expires Drive refresh tokens after about 7 days and you'll need to reconnect. Publish the app (In production) to avoid this.

### 3. Environment variables

Copy `.env.example` to `.env.local` (local) or add each one in Vercel → Settings → Environment Variables. Generate secrets with `node scripts/generate-secrets.mjs`.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Server only, never `NEXT_PUBLIC_` |
| `ADMIN_EMAIL` | Admin login email; comma-separate several |
| `CRON_SECRET` | Random, at least 32 chars; Vercel Cron sends it automatically |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 64 hex chars. Changing it means reconnecting Drive |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud |
| `GOOGLE_REDIRECT_URI` | Must exactly match one in Google Cloud |
| `PUBLIC_CLIENT_TOKEN` | Optional; only keeps old `/client/<token>` links redirecting |

### 4. Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Then `/login` → `/admin` → **Connect Google Drive** → paste your reel folder link → **Save folder** → **Sync now**.

### 5. Deploy to Vercel

1. Import the GitHub repo in Vercel (framework: Next.js; defaults are fine).
2. The included `vercel.json` (one daily cron) deploys on **Hobby** and Pro. Note that Vercel's Hobby plan is for non-commercial use only; client work like this is meant for **Pro**. On Pro you can optionally make the cron more frequent, e.g. `"*/15 * * * *"`.
3. Add all environment variables for **Production** (and Preview if you use it), with `GOOGLE_REDIRECT_URI=https://YOUR-DOMAIN/api/gdrive/callback`.
4. Deploy, then add that redirect URI in Google Cloud.
5. Optional: add a custom domain. The client dashboard URL is the domain root, `https://YOUR-DOMAIN/`.

---

## Verification

```bash
npm run verify       # lint + typecheck + unit tests + production build
```

- `tests/billing.test.ts`: ₹600 rule and 60/61 s boundary, confirmed prices, all 262 weeks through 2030 and every day 2026–2030, year-boundary weeks, partial/full/over-payments, totals, midnight-IST Today/Yesterday.
- `tests/sync-plan.test.ts`: duplicate Drive imports, renames, locked durations, revisions, re-upload detection, admin allow-list.
- `tests/public-ledger.test.ts`: nothing private reaches the public page.
- `tests/sql/`: runs every migration against a real Postgres (`cd tests/sql && npm install && npm test`; needs a non-root user).
- `tests/visual/mock-supabase.mjs`: **test-only** sample-data server for checking layouts locally without touching your database.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Homepage says records are unavailable | The server can't reach Supabase. Check the URL/keys in Vercel or `.env.local`; restart. |
| Admin shows "missing column" / "run sql/migrate_v1_3.sql" | Run the V1.3 migration. |
| `redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI` must exactly match Google Cloud (scheme, domain, path). |
| `access_denied` | Add your Google account as a test user, or publish the consent screen. |
| "authorization expired or was revoked" | Disconnect and reconnect Google Drive (common in Testing mode after 7 days). |
| "Folder not found" / 403 | The connected Google account must be able to open that folder. |
| Signed in but sent back to login with "not authorised" | That email isn't in `ADMIN_EMAIL`. |
| Mohit can't open a video | Share the Drive folder/file with his Google account. |

## Limitations

- If instant sync is unavailable (e.g. on localhost), sync falls back to polling: a new upload appears on the next dashboard visit after 15 minutes have passed since the last sync (the visit that starts the sync shows it on the next refresh, within about a minute), or at the daily run. Use **Sync now** for an immediate check.
- One sync handles up to about 10,000 videos / 120 sub-folders within Vercel's 60-second function limit.
- Payments are recorded manually; this is a ledger, not a payment processor or accounting system.
