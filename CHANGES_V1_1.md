# CrazifiedEdits V1.1 · Crazified Studios

## Updated startup flow

1. `/` — **Public-first** weekly reel log, billing summary and payment history, no login.
2. `/login` — Advik's admin sign in, linked in the public header.
3. `/admin` — Authenticated editing, OneDrive connection, review, delivery logs and payment entry.

## Brand identity

- Production studio: **Crazified Studios** (uploaded CRAZIFIED logo used unchanged)
- Editor / studio admin: **Advik**
- Client: **Mohit** (`@OkayMohit` on YouTube and Instagram)
- Client profile photo supplied by user, used on read-only landing page

## Security and privacy

- Public dashboard includes only delivered, approved or revision-requested reels.
- Draft, cancelled and not-yet-delivered reels are never sent to the browser.
- Internal reel notes, Graph item IDs, drive IDs, and private payment reference notes are not sent to the browser.
- Admin-only routes and actions still require the approved Supabase user.
- Homepage has no password: anybody knowing your website URL can view the totals and delivery records. OneDrive file permissions remain separate.

## Business rules retained

- ₹600 per eligible reel, up to and including 60 seconds.
- Billing weeks Monday–Sunday, with Sunday week-ending.
- Synced OneDrive files start as Needs review; confirmed deliveries count toward billing.
- Payments and partial payments calculate due balances.
- Scheduled OneDrive sync requires deployment + Microsoft/Supabase credentials; not built into static preview.

## Preview

Double-click `preview.html` to see the Crazified/Mohit **public** ledger design with demonstration data. It is a visual preview, not a connected application.
