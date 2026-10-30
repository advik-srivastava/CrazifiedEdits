import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, CreditCard, Layers3, Wallet, CheckCircle2, Clock3, LayoutDashboard, FolderSync, ShieldCheck, CalendarDays, LockKeyhole, Clapperboard } from "lucide-react";
import type { ReactNode } from "react";
import type { LedgerTotals } from "@/lib/models";
import { formatINR } from "@/lib/billing";

export function Brand(){return <Link href="/" className="brand crazified-brand" aria-label="CrazifiedEdits home"><Image src="/images/crazified-logo.png" width={158} height={43} alt="Crazified Studios logo" priority/><strong className="product-brand-name">CrazifiedEdits</strong><small>BY CRAZIFIED STUDIOS</small></Link>}
export function Header({label,children}:{label:string;children?:ReactNode}) {
  return <header className="topbar"><div className="topbar-inner"><Brand/><div className="header-right"><span className="header-label">{label}</span>{children}</div></div></header>;
}
export function Pill({children,tone="neutral"}:{children:ReactNode;tone?:"neutral"|"green"|"orange"|"blue"|"red"}){return <span className={`pill pill-${tone}`}>{children}</span>}
export function StatCard({label,value,icon,detail,featured=false}:{label:string;value:string|number;icon:ReactNode;detail?:string;featured?:boolean}){
  return <div className={`stat-card ${featured?"stat-featured":""}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><span className="stat-detail">{detail||"This billing week"}</span></div>;
}
export function SectionHeading({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}){
  return <div className="section-head"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>;
}
export const statusView:Record<string,{name:string,tone:"neutral"|"green"|"orange"|"blue"|"red"}>={
  discovered:{name:"Needs review",tone:"orange"},delivered:{name:"Delivered",tone:"blue"},revision:{name:"Revision",tone:"orange"},approved:{name:"Approved",tone:"green"},cancelled:{name:"Cancelled",tone:"neutral"}
};
export function Status({status}:{status:string}){const s=statusView[status]||statusView.discovered;return <Pill tone={s.tone}><span className="dot"/>{s.name}</Pill>}
export function Empty({title,description,icon}:{title:string;description:string;icon?:ReactNode}){return <div className="empty-state"><div className="empty-icon">{icon||<Layers3 size={26}/>}</div><h3>{title}</h3><p>{description}</p></div>}
export const icons={CreditCard,Wallet,CheckCircle2,Clock3,LayoutDashboard,FolderSync,ShieldCheck,CalendarDays,ArrowUpRight,LockKeyhole};

/** All-time totals across every billing week. */
export function OverviewTotals({totals}:{totals:LedgerTotals}){
  const credit=totals.outstanding<0;
  return <section className="totals-grid" aria-label="All-time totals">
    <div className="total-card"><span className="total-label"><Clapperboard size={16} aria-hidden/>Total reels delivered</span><strong>{totals.delivered}</strong><small>{totals.reviewCount?`${totals.billedReels} billed · ${totals.reviewCount} in pricing review`:`${totals.billedReels} billed`}</small></div>
    <div className="total-card"><span className="total-label"><CreditCard size={16} aria-hidden/>Total billed</span><strong>{formatINR(totals.billed)}</strong><small>All billing weeks</small></div>
    <div className="total-card"><span className="total-label"><CheckCircle2 size={16} aria-hidden/>Total received</span><strong>{formatINR(totals.received)}</strong><small>All recorded payments</small></div>
    <div className={`total-card total-featured ${totals.outstanding>0?"has-due":""}`}><span className="total-label"><Wallet size={16} aria-hidden/>{credit?"Credit balance":"Outstanding balance"}</span><strong>{formatINR(Math.abs(totals.outstanding))}</strong><small>{totals.outstanding>0?"Awaiting payment":credit?"Paid in advance":"All settled"}</small></div>
  </section>;
}
