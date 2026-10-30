import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Clapperboard, Eye, Instagram, LockKeyhole, ShieldCheck, Youtube } from "lucide-react";
import { buildLedger, todayInIndia } from "@/lib/billing";
import { getPublicDashboard } from "@/lib/data";
import { isConfigured } from "@/lib/supabase";
import { Header, Pill } from "@/components/ui";
import { WeekLedger, UnpricedReels } from "@/components/week-ledger";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // This is the PUBLIC landing page. Never require an admin session here.
  // The server sends only a curated subset of approved delivery/payment data.
  const configured = isConfigured();
  let databaseError = false;
  let dashboard: Awaited<ReturnType<typeof getPublicDashboard>> = {weeks:buildLedger([], [], todayInIndia()), reels:[]};
  if(configured){
    try {dashboard=await getPublicDashboard();}
    catch(error){
      databaseError=true;
      console.error("Public ledger unavailable:",error instanceof Error?error.message:"Unknown database error");
    }
  }
  return <>
    <Header label="PUBLIC DELIVERY LEDGER">
      <Link href="/login" className="header-admin-link"><LockKeyhole size={15}/> Admin sign in <ArrowRight size={15}/></Link>
    </Header>
    <main className="app-main public-main">
      <div className="public-hero">
        <div className="public-hero-copy">
          <div className="public-kicker"><span className="public-kicker-dot"/> CRAZIFIEDEDITS <span className="public-kicker-rule"/> CLIENT WORKSPACE</div>
          <h1>Every reel.<br/><span>Every payment.</span><br/>All in one place.</h1>
          <p>Live delivery logs, clear Sunday settlements, and direct Google Drive video access — a shared record for <strong>Advik</strong> and <strong>Mohit</strong>.</p>
          <div className="public-hero-chips"><span><Clapperboard size={15}/> Reel delivery log</span><span><ShieldCheck size={15}/> Transparent billing</span><span><Eye size={15}/> Read only</span></div>
        </div>
        <aside className="client-identity">
          <span className="client-identity-label">CLIENT ACCOUNT</span>
          <div className="client-identity-main">
            <Image src="/images/mohit-avatar.png" width={62} height={62} alt="Client profile photo" className="mohit-avatar"/>
            <div><div className="client-name">Mohit</div><div className="client-handle">@OkayMohit</div></div>
          </div>
          <div className="identity-platforms"><span><Youtube size={16}/> YouTube</span><span><Instagram size={16}/> Instagram</span></div>
          <div className="identity-divider"/>
          <div className="identity-editor"><span>CREATIVE PARTNER</span><strong>Advik <span>· Crazified Studios</span></strong></div>
        </aside>
      </div>
      <div className="public-subheader"><div><span className="eyebrow">CRAZIFIEDEDITS · SHARED LEDGER</span><h2>Reel logs &amp; payments</h2><p>Switch between billing weeks to review deliveries and payment history.</p></div><Pill tone="green"><span className="live-dot"/> Client view</Pill></div>
      {!configured && <div className="public-setup-note">This is the live portal layout. Connect Supabase in <code>.env.local</code> to load actual deliveries and payments. The standalone <code>preview.html</code> contains design sample data.</div>}
      {databaseError ? <div className="public-setup-note" role="alert"><strong>Payment records temporarily unavailable.</strong> The app could not connect to Supabase. No payment totals are shown until the connection is restored. Check the PowerShell server error and your Supabase URL/network settings, then refresh.</div> : <><WeekLedger weeks={dashboard.weeks} clientView/><UnpricedReels reels={dashboard.reels}/></>}
      <div className="public-bottom-strip"><ShieldCheck size={18}/><span>Read-only access. Only Advik can edit reel records and payments after signing in. Google Drive files require separate Google sharing permission.</span><Link href="/login">Studio login <ArrowRight size={14}/></Link></div>
      <footer className="app-footer"><span>© 2026 Crazified Studios · Produced by Advik</span><span>Made for Mohit (@OkayMohit) · ₹600/reel · Sunday billing</span></footer>
    </main>
  </>;
}
