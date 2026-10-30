import { headers } from "next/headers";
import Link from "next/link";
import { after } from "next/server";
import { syncIfStale } from "@/lib/google-drive";
import { LogOut, ShieldCheck, Sparkles, Video, Eye, AlertCircle } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getConnection, getDashboard, getSettings, getSyncEvents } from "@/lib/data";
import { isConfigured } from "@/lib/supabase";
import { Header, OverviewTotals, Pill } from "@/components/ui";
import { WeekLedger, UnpricedReels } from "@/components/week-ledger";
import { ActivityPanel } from "@/components/activity";
import { AutoRefresh, OfflineBanner } from "@/components/live";
import { AddReelForm, AdminReelList, ClientLink, GoogleDrivePanel, PaymentEntry } from "@/components/admin-panels";
import { adminLedgerReel } from "@/lib/public-ledger";
import { todayInIndia } from "@/lib/billing";

/** True while another sync holds the lock. */
function syncRunning(lockUntil: string | null | undefined): boolean {
  return !!lockUntil && Date.parse(lockUntil) > Date.now();
}
import { signOut } from "./actions";

export const dynamic = "force-dynamic";
// Room for the background Drive sync that may run after the page is sent.
export const maxDuration = 60;
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  if (!isConfigured()) return <main className="centered"><div className="auth-panel"><span className="overline">SETUP REQUIRED</span><h1>Finish the environment setup</h1><p>Set the Supabase variables and <code>ADMIN_EMAIL</code> (see <code>.env.example</code>), run the SQL files in <code>sql/</code>, then restart or redeploy.</p><p>README.md has the step-by-step guide.</p></div></main>;
  const user = await requireAdmin();
  after(syncIfStale);
  const params = await searchParams;
  let data;
  try {
    const [dashboard, settings, connection, events] = await Promise.all([getDashboard(), getSettings(), getConnection(), getSyncEvents()]);
    data = { dashboard, settings, connection, events };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Admin dashboard unavailable:", message);
    return <main className="centered"><div className="auth-panel" role="alert"><span className="overline">DATABASE UNAVAILABLE</span><h1>Couldn&apos;t load your records</h1><p>The app reached Supabase but the request failed, or Supabase is unreachable. No data was changed.</p><p className="muted"><AlertCircle size={14} aria-hidden /> {message.slice(0, 200)}</p><p className="muted">Check the Supabase URL and service-role key, and that every file in <code>sql/</code> has been run. Then refresh.</p><Link className="button primary" href="/admin">Try again</Link></div></main>;
  }
  const { dashboard, settings, connection, events } = data;
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const clientUrl = `${protocol}://${host}/`;
  const sync = { lastSyncedAt: settings.last_sync_at, healthy: !settings.last_sync_error };
  return <><Header label="ADMIN WORKSPACE"><Link href="/" className="header-admin-link" aria-label="Open client view"><Eye size={15} aria-hidden /> <span className="header-admin-text">Client view</span></Link><Pill tone="green"><ShieldCheck size={13} aria-hidden /> Admin</Pill><form action={signOut}><button className="logout-btn" type="submit" title="Sign out" aria-label="Sign out"><LogOut size={17} aria-hidden /></button></form></Header>
    <OfflineBanner />
    <AutoRefresh intervalMs={90_000} />
    <main className="app-main"><div className="workspace-kicker"><span><span className="live-dot" />CRAZIFIEDEDITS · CRAZIFIED STUDIOS</span><span>Signed in as {user.email}</span></div>
      {params.success && <div className="toast-message success-message" role="status"><Sparkles size={18} aria-hidden />{params.success}</div>}
      {params.error && <div className="toast-message error-message" role="alert">{params.error}</div>}
      <OverviewTotals totals={dashboard.totals} />
      <ActivityPanel daily={dashboard.daily} sync={sync} />
      <UnpricedReels reels={dashboard.reels.filter(r => r.delivery_date).map(adminLedgerReel)} />
      <WeekLedger weeks={dashboard.weeks} />
      <div className="admin-section-head"><div><div className="eyebrow">YOUR CONTROL CENTER</div><h2>Manage deliveries</h2><p>Connect Google Drive, review new uploads, mark deliveries and record Mohit&apos;s payments. The homepage shows only delivered reels and weekly settlements.</p></div><a href="#reels" className="button secondary"><Video size={16} aria-hidden />Review videos</a></div>
      <div className="admin-two-col"><GoogleDrivePanel settings={settings} connection={connection} events={events} syncInProgress={syncRunning(settings.sync_lock_until)} /><AddReelForm /></div>
      <AdminReelList reels={dashboard.reels} />
      <div className="admin-two-col lower"><PaymentEntry payments={dashboard.payments} /><section className="surface sharing-panel"><div className="eyebrow">CLIENT ACCESS</div><h2>Share the live ledger</h2><p>Mohit can open the homepage to see delivered reels, Drive links and payments without signing in. Only you can edit records.</p><ClientLink url={clientUrl} /><div className="sharing-note"><ShieldCheck size={17} aria-hidden /><span>The homepage is public to anyone with the URL and is hidden from search engines. It never shows notes, payment references, pending uploads or account settings. Google Drive files still follow their own Drive sharing settings.</span></div></section></div>
      <footer className="app-footer"><span>© {todayInIndia().slice(0, 4)} Crazified Studios • Edited by Advik</span><span>Monday–Sunday billing · ₹600 per reel up to 60 s</span></footer>
    </main></>;
}
