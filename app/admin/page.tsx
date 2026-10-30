import { headers } from "next/headers";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, LogOut, ShieldCheck, Sparkles, Video, Eye } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getConnection, getDashboard, getSettings } from "@/lib/data";
import { isConfigured } from "@/lib/supabase";
import { Header, Pill } from "@/components/ui";
import { WeekLedger, UnpricedReels } from "@/components/week-ledger";
import { AddReelForm, AdminReelList, ClientLink, GoogleDrivePanel, PaymentEntry, SubmitButton } from "@/components/admin-panels";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";
export default async function AdminPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}) {
  if (!isConfigured()) return <main className="centered"><div className="auth-panel"><span className="overline">SETUP REQUIRED</span><h1>Complete your .env.local setup</h1><p>Copy <code>.env.example</code> to <code>.env.local</code>, configure Supabase and run <code>sql/schema.sql</code>, then restart the server.</p><p>See README.md for the step-by-step guide.</p></div></main>;
  const user=await requireAdmin();
  const [dashboard,settings,connection,params,requestHeaders]=await Promise.all([getDashboard(),getSettings(),getConnection(),searchParams,headers()]);
  const protocol=process.env.NODE_ENV==="production"?"https":"http";
  const host=requestHeaders.get("host")||"localhost:3000";
  const clientUrl=`${protocol}://${host}/`;
  return <><Header label="ADVIK · ADMIN WORKSPACE"><Link href="/" className="header-admin-link"><Eye size={15}/> Client view</Link><Pill tone="green"><ShieldCheck size={13}/> Admin</Pill><form action={signOut}><button className="logout-btn" type="submit" title="Sign out"><LogOut size={17}/></button></form></Header>
    <main className="app-main"><div className="workspace-kicker"><span><span className="live-dot"/>CRAZIFIEDEDITS · CRAZIFIED STUDIOS</span><span>Signed in as {user.email}</span></div>
      {params.success&&<div className="toast-message success-message"><Sparkles size={18}/>{params.success}</div>}
      {params.error&&<div className="toast-message error-message">{params.error}</div>}
      <WeekLedger weeks={dashboard.weeks}/><UnpricedReels reels={dashboard.reels}/>
      <div className="admin-section-head"><div><div className="eyebrow">YOUR CONTROL CENTER</div><h2>Manage deliveries</h2><p>Connect Google Drive, confirm deliveries and record Mohit’s payments. The public homepage shows only approved delivery records and weekly settlements.</p></div><a href="#reels" className="button secondary"><Video size={16}/>Review videos</a></div>
      <div className="admin-two-col"><GoogleDrivePanel settings={settings} connection={connection}/><AddReelForm/></div>
      <AdminReelList reels={dashboard.reels}/>
      <div className="admin-two-col lower"><PaymentEntry payments={dashboard.payments}/><section className="surface sharing-panel"><div className="eyebrow">CLIENT ACCESS</div><h2>Share the live ledger</h2><p>Mohit can open the homepage to view delivery links, reel counts and payments without signing in. Only Advik can edit records.</p><ClientLink url={clientUrl}/><div className="sharing-note"><ShieldCheck size={17}/><span>The homepage is publicly accessible without a password. Anyone who knows your site URL can read this ledger. For private client data, enable a secret-link or login gate before production. Google Drive links still need separate sharing permission.</span></div></section></div>
      <footer className="app-footer"><span>© 2026 Crazified Studios • Produced by Advik</span><span>Monday–Sunday billing · ₹600 per eligible reel</span></footer>
    </main></>;
}
