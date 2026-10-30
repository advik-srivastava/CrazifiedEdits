"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, Clapperboard, CreditCard, Wallet, CheckCircle2, Video, ChevronDown, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import type { LedgerReel, WeekSummary } from "@/lib/models";
import { durationLabel, formatINR, prettyDate, reelFee, sundayFor, todayInIndia } from "@/lib/billing";
import { Empty, Pill, SectionHeading, StatCard, Status } from "./ui";

function reelSource(source:LedgerReel["source"]) {
  return source==="google_drive"?"Google Drive synced":source==="onedrive"?"Legacy OneDrive link":"Manual entry";
}
function FileAccess({reel}:{reel:LedgerReel}){
  const url=reel.client_url||reel.drive_web_url;
  return url?<a className="file-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${reel.title} on Google Drive`}><ArrowUpRight size={16}/><span>Open file</span></a>:<span className="muted">Not shared</span>;
}
function WeekTable({week}:{week:WeekSummary}){
  const visible=[...week.reels].sort((a,b)=>(b.delivery_date||"").localeCompare(a.delivery_date||""));
  if(!visible.length)return <Empty title="No delivered reels this week" description="When Advik marks a video delivered, it appears in this exact billing week." icon={<Clapperboard/>}/>;
  return <>
    <div className="table-scroll desktop-delivery-table" role="region" aria-label="Weekly delivery table" tabIndex={0}>
      <table className="data-table"><thead><tr><th>REEL / VIDEO</th><th>DELIVERED</th><th>DURATION</th><th>STATUS</th><th className="align-right">AMOUNT</th><th className="align-right">GOOGLE DRIVE</th></tr></thead>
        <tbody>{visible.map(reel=><tr key={reel.id}>
          <td><div className="file-name"><span className="small-file-icon"><Video size={16}/></span><span><strong title={reel.title}>{reel.title}</strong><small>{reelSource(reel.source)}</small></span></div></td>
          <td>{prettyDate(reel.delivery_date!)}</td><td className="mono">{durationLabel(reel.duration_seconds)}</td><td><Status status={reel.status}/></td>
          <td className="align-right strong mono">{reelFee(reel)?formatINR(reelFee(reel)):<Pill tone="orange">Unbilled</Pill>}</td>
          <td className="align-right"><FileAccess reel={reel}/></td>
        </tr>)}</tbody></table>
    </div>
    <div className="mobile-delivery-list">{visible.map(reel=><article className="mobile-reel-card" key={reel.id}>
      <div className="mobile-reel-top"><div className="mobile-reel-title"><span className="small-file-icon"><Video size={17}/></span><div><strong>{reel.title}</strong><small>{reelSource(reel.source)}</small></div></div><Status status={reel.status}/></div>
      <div className="mobile-reel-details"><span>{prettyDate(reel.delivery_date!)}</span><span>{durationLabel(reel.duration_seconds)}</span><strong>{reelFee(reel)?formatINR(reelFee(reel)):"Unbilled"}</strong></div>
      <div className="mobile-reel-action"><FileAccess reel={reel}/></div>
    </article>)}</div>
  </>;
}
export function WeekLedger({weeks,clientView=false}:{weeks:WeekSummary[];clientView?:boolean}){
  const current=sundayFor(todayInIndia());
  const ordered=useMemo(()=>[...weeks].sort((a,b)=>a.ending.localeCompare(b.ending)),[weeks]);
  const [end,setEnd]=useState(weeks.some(w=>w.ending===current)?current:weeks[0]?.ending||"");
  const selected=weeks.find(w=>w.ending===end)||weeks[0];
  const calendarYear=(w:WeekSummary)=>w.starting<"2026-01-01"&&w.ending>="2026-01-01"?"2026":w.starting.slice(0,4);
  const years=useMemo(()=>[...new Set(weeks.map(calendarYear))].sort(),[weeks]);
  const activeYear=selected?calendarYear(selected):"2026";
  const yearWeeks=useMemo(()=>ordered.filter(w=>calendarYear(w)===activeYear),[ordered,activeYear]);
  const selectedIndex=ordered.findIndex(w=>w.ending===selected?.ending);
  const chartWeeks=ordered.slice(Math.max(0,selectedIndex-7),selectedIndex+1);
  const maximum=Math.max(600,...chartWeeks.map(w=>w.billed));
  const goYear=(year:string)=>{
    const matches=ordered.filter(w=>calendarYear(w)===year);
    if(matches.length)setEnd(year===todayInIndia().slice(0,4)&&matches.some(w=>w.ending===current)?current:matches[0].ending);
  };
  if(!selected)return null;
  return <>
    <div className="summary-header"><div><div className="eyebrow">PAYMENT OVERVIEW · WEEKLY LOGS THROUGH 2030</div>
      <h1>{clientView?"Your weekly payment overview":"Production overview"}</h1>
      <p>Every week has its own Monday–Sunday reel log and payment balance.</p></div>
      <div className="billing-navigation" aria-label="Billing week navigation">
        <div className="billing-picker-row"><label className="year-selector"><span>Year</span><select value={activeYear} onChange={e=>goYear(e.target.value)} aria-label="Choose billing year">{years.map(y=><option key={y} value={y}>{y}</option>)}</select><ChevronDown size={15}/></label>
          <label className="week-selector"><CalendarDays size={17}/><select value={selected.ending} onChange={e=>setEnd(e.target.value)} aria-label="Choose Monday to Sunday billing week">{yearWeeks.map(w=><option key={w.ending} value={w.ending}>{prettyDate(w.starting)} – {prettyDate(w.ending)}</option>)}</select><ChevronDown size={16}/></label></div>
        <div className="week-stepper"><button type="button" className="week-step" onClick={()=>setEnd(ordered[selectedIndex-1].ending)} disabled={selectedIndex<=0} aria-label="Previous billing week"><ChevronLeft size={17}/> Previous</button>
          <button type="button" className="week-current" onClick={()=>setEnd(current)} disabled={selected.ending===current}>Current week</button>
          <button type="button" className="week-step" onClick={()=>setEnd(ordered[selectedIndex+1].ending)} disabled={selectedIndex>=ordered.length-1}>Next <ChevronRight size={17}/></button></div>
      </div>
    </div>
    <div className="stats-grid"><StatCard label="Billable reels" value={selected.count} icon={<Clapperboard size={19}/>} detail="Up to 60 seconds each"/><StatCard label="Total billed" value={formatINR(selected.billed)} icon={<CreditCard size={19}/>} detail="₹600 per eligible reel"/><StatCard label="Payment received" value={formatINR(selected.received)} icon={<CheckCircle2 size={19}/>} detail="Recorded for this week"/><StatCard label="Balance due" value={formatINR(selected.due)} icon={<Wallet size={19}/>} detail={selected.due===0?"No outstanding balance":"Awaiting payment"} featured/></div>
    <div className="content-grid"><section className="surface chart-card"><SectionHeading eyebrow="EARNINGS" title="Weekly performance" description="Eight billing periods ending at the selected week"/>
      <div className="bar-chart" aria-label="Eight-week earnings chart">{chartWeeks.map(w=><button key={w.ending} type="button" title={`${prettyDate(w.ending)} • ${formatINR(w.billed)}`} onClick={()=>setEnd(w.ending)} className={`bar-column ${selected.ending===w.ending?"selected":""}`} aria-label={`View week ending ${prettyDate(w.ending)}, billed ${formatINR(w.billed)}`}>
        <span className="bar-amount">{w.billed?`₹${(w.billed/1000).toFixed(1)}k`:"₹0"}</span><span className="bar-track"><span className="bar-fill" style={{height:`${Math.max(4,w.billed/maximum*100)}%`}}/></span>
        <span className="bar-label">{new Date(`${w.ending}T12:00:00Z`).toLocaleDateString("en-IN",{day:"numeric",month:"short",timeZone:"UTC"})}</span></button>)}</div></section>
      <section className="surface settlement-card"><SectionHeading eyebrow="BILLING DETAILS" title="Week settlement" description={`${prettyDate(selected.starting)} – ${prettyDate(selected.ending)}`}/><div className="receipt-lines"><div><span>Billable reels</span><strong>{selected.count}</strong></div><div><span>Rate per reel</span><strong>₹600</strong></div><div><span>Subtotal</span><strong>{formatINR(selected.billed)}</strong></div><div><span>Paid to date</span><strong className="green-text">– {formatINR(selected.received)}</strong></div><div className="receipt-total"><span>Amount due</span><strong>{formatINR(selected.due)}</strong></div></div><Pill tone={selected.due<=0?"green":"orange"}>{selected.due<=0?"Fully settled":"Awaiting payment"}</Pill></section></div>
    <section className="surface log-card"><div className="table-heading"><SectionHeading eyebrow="DELIVERY HISTORY" title="Weekly reel log" description={`${selected.reels.length} delivered video${selected.reels.length===1?"":"s"} · ${selected.count} billable · ${prettyDate(selected.starting)} – ${prettyDate(selected.ending)}`}/><span className="soft-label"><span className="live-dot"/>LIVE RECORD</span></div><WeekTable week={selected}/></section>
    <section className="surface history-card"><SectionHeading eyebrow="TRANSACTIONS" title="Payment history" description="Payments linked only to the selected billing week"/>{selected.payments.length?<div className="payments-list">{selected.payments.map(payment=><div className="payment-row" key={payment.id}><div className="payment-icon"><CheckCircle2 size={18}/></div><div className="payment-info"><strong>Payment received</strong><small>{prettyDate(payment.paid_on)}{payment.note?` · ${payment.note}`:""}</small></div><strong className="green-text">+ {formatINR(Number(payment.amount))}</strong></div>)}</div>:<div className="no-transactions"><AlertCircle size={18}/><span>No payments recorded for this week.</span></div>}</section>
  </>;
}
export function UnpricedReels({reels}:{reels:LedgerReel[]}){
  const excluded=reels.filter(r=>["delivered","revision","approved"].includes(r.status)&&r.delivery_date&&!reelFee(r));
  if(!excluded.length)return null;
  return <div className="warning-message"><AlertCircle size={18}/><div><strong>{excluded.length} delivered video(s) not yet billed</strong><p>Duration is missing or over 60 seconds. Confirm pricing separately; these videos are not included in ₹600 totals.</p></div></div>;
}
