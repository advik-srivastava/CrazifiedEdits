import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Clapperboard, Eye, Instagram, LockKeyhole, ShieldCheck, Youtube } from "lucide-react";
import { buildLedger, ledgerTotals, todayAndYesterday, todayInIndia } from "@/lib/billing";
import { getPublicDashboard } from "@/lib/data";
import { publicLedgerReel } from "@/lib/public-ledger";
import { isConfigured } from "@/lib/supabase";
import { Header, OverviewTotals } from "@/components/ui";
import { WeekLedger, UnpricedReels } from "@/components/week-ledger";
import { ActivityPanel } from "@/components/activity";
import { AutoRefresh, OfflineBanner } from "@/components/live";

export const dynamic = "force-dynamic";

function emptyDashboard(): Awaited<ReturnType<typeof getPublicDashboard>> {
  const weeks = buildLedger([], [], todayInIndia());
  return { weeks, reels: [], totals: ledgerTotals(weeks), daily: todayAndYesterday([], publicLedgerReel), sync: { lastSyncedAt: null, healthy: true } };
}

export default async function HomePage() {
  // This is the PUBLIC landing page. Never require an admin session here.
  // The server sends only a curated, read-only subset of delivery/payment data.
  const configured = isConfigured();
  let databaseError = false;
  let dashboard = emptyDashboard();
  if (configured) {
    try { dashboard = await getPublicDashboard(); }
    catch (error) {
      databaseError = true;
      console.error("Public ledger unavailable:", error instanceof Error ? error.message : "Unknown database error");
    }
  }
  return <>
    <a href="#ledger" className="skip-link">Skip to reel log</a>
    <Header label="CLIENT DELIVERY LEDGER">
      <Link href="/login" className="header-admin-link" aria-label="Admin sign in"><LockKeyhole size={15} aria-hidden /> <span className="header-admin-text">Admin sign in</span></Link>
    </Header>
    <OfflineBanner />
    {configured && !databaseError && <AutoRefresh />}
    <main className="app-main public-main">
      <div className="public-hero">
        <div className="public-hero-copy">
          <div className="public-kicker"><span className="public-kicker-dot" /> CRAZIFIEDEDITS <span className="public-kicker-rule" /> CLIENT WORKSPACE</div>
          <h1>Every reel.<br /><span>Every payment.</span><br />All in one place.</h1>
          <p>Live delivery logs, clear Sunday settlements, and direct Google Drive video access — a shared record for <strong>Advik</strong> and <strong>Mohit</strong>.</p>
          <div className="public-hero-chips"><span><Clapperboard size={15} aria-hidden /> Reel delivery log</span><span><ShieldCheck size={15} aria-hidden /> Transparent billing</span><span><Eye size={15} aria-hidden /> Read only</span></div>
        </div>
        <aside className="client-identity" aria-label="Client and studio">
          <span className="client-identity-label">CLIENT ACCOUNT</span>
          <div className="client-identity-main">
            <Image src="/images/mohit-avatar.png" width={62} height={62} alt="Mohit" className="mohit-avatar" />
            <div><div className="client-name">Mohit</div><div className="client-handle">@OkayMohit</div></div>
          </div>
          <div className="identity-platforms"><span><Youtube size={16} aria-hidden /> YouTube</span><span><Instagram size={16} aria-hidden /> Instagram</span></div>
          <div className="identity-divider" />
          <div className="identity-editor"><span>EDITOR</span><strong>Advik <span>· Crazified Studios</span></strong></div>
        </aside>
      </div>
      {!configured && <div className="public-setup-note">The portal isn&apos;t connected to its database yet, so no deliveries or payments are shown. (Admin: set the Supabase variables in your environment.)</div>}
      {databaseError ? <div className="public-setup-note" role="alert"><strong>Reel and payment records are temporarily unavailable.</strong> We couldn&apos;t reach the database, so no totals are shown rather than showing incorrect ones. Please refresh in a few minutes.</div> : <>
        <OverviewTotals totals={dashboard.totals} />
        <ActivityPanel daily={dashboard.daily} sync={dashboard.sync} clientView />
        <div id="ledger" className="ledger-anchor" tabIndex={-1} />
        <UnpricedReels reels={dashboard.reels} clientView />
        <WeekLedger weeks={dashboard.weeks} clientView />
      </>}
      <div className="public-bottom-strip"><ShieldCheck size={18} aria-hidden /><span>Read-only view. Only the studio admin can edit reels and payments. Opening a Google Drive file may need Drive sharing permission.</span><Link href="/login">Studio login <ArrowRight size={14} aria-hidden /></Link></div>
      <footer className="app-footer"><span>© {todayInIndia().slice(0, 4)} Crazified Studios · Edited by Advik</span><span>For Mohit (@OkayMohit) · ₹600 per reel up to 60 s · Monday–Sunday billing</span></footer>
    </main>
  </>;
}
