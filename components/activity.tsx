"use client";
import { useState } from "react";
import { CloudUpload, PackageCheck, IndianRupee, Hourglass, CircleCheck, CircleAlert, Clock3 } from "lucide-react";
import type { DayActivity, PublicSyncStatus } from "@/lib/models";
import { durationLabel, formatINR, prettyDate, prettyDateTime } from "@/lib/billing";
import { FeeLabel, FileAccess } from "./week-ledger";

export function SyncChip({ sync }: { sync: PublicSyncStatus }) {
  if (!sync.lastSyncedAt) return <span className="sync-chip sync-chip-idle"><Clock3 size={14} aria-hidden />Not synced yet</span>;
  return <span className={`sync-chip ${sync.healthy ? "sync-chip-ok" : "sync-chip-warn"}`} title={sync.healthy ? "Google Drive sync is healthy" : "The latest Google Drive sync had a problem"}>
    {sync.healthy ? <CircleCheck size={14} aria-hidden /> : <CircleAlert size={14} aria-hidden />}
    <span>Last synced <time dateTime={sync.lastSyncedAt}>{prettyDateTime(sync.lastSyncedAt)}</time></span>
    {!sync.healthy && <span className="sr-only">. The latest sync needs attention.</span>}
  </span>;
}

/** Today / Yesterday in India time. Upload date and delivery date are separate:
 * a reel uploaded yesterday can be approved and delivered today. */
export function ActivityPanel({ daily, sync, clientView = false }: { daily: { today: DayActivity; yesterday: DayActivity }; sync: PublicSyncStatus; clientView?: boolean }) {
  const [tab, setTab] = useState<"today" | "yesterday">("today");
  const day = daily[tab];
  const tabs = [["today", "Today", daily.today], ["yesterday", "Yesterday", daily.yesterday]] as const;
  return <section className="surface activity-card" aria-labelledby="activity-heading">
    <div className="activity-head">
      <div><div className="eyebrow">LIVE ACTIVITY · INDIA TIME (IST)</div><h2 id="activity-heading">Today &amp; yesterday</h2></div>
      <SyncChip sync={sync} />
    </div>
    <div className="activity-tabs" role="tablist" aria-label="Choose day">
      {tabs.map(([id, label, d]) => <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="activity-panel" className={`activity-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
        <span>{label}</span><small>{prettyDate(d.date)}</small>
      </button>)}
    </div>
    <div id="activity-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      <div className="activity-metrics">
        <div className="activity-metric"><CloudUpload size={18} aria-hidden /><strong>{day.uploaded}</strong><span>Uploaded</span></div>
        <div className="activity-metric"><PackageCheck size={18} aria-hidden /><strong>{day.delivered}</strong><span>Delivered</span></div>
        <div className="activity-metric activity-metric-money"><IndianRupee size={18} aria-hidden /><strong>{formatINR(day.billed)}</strong><span>Billed on delivery</span></div>
        <div className="activity-metric"><Hourglass size={18} aria-hidden /><strong>{day.pendingReview}</strong><span>Pending review</span></div>
      </div>
      <p className="activity-footnote">Uploaded counts videos added to Google Drive on this date. Delivered counts reels approved on this date, which is when they&apos;re billed.</p>
      {day.deliveredReels.length ? <ul className="activity-list" aria-label={`Reels delivered ${tab}`}>
        {day.deliveredReels.map(r => <li key={r.key}><span className="activity-reel-title"><strong>{r.title}</strong><small>{durationLabel(r.duration_seconds)}</small></span><span className="activity-reel-fee"><FeeLabel reel={r} /></span><FileAccess reel={r} /></li>)}
      </ul> : <p className="activity-empty">{tab === "today" ? "No reels delivered yet today." : "No reels were delivered yesterday."}{!clientView && day.pendingReview > 0 ? ` ${day.pendingReview} upload${day.pendingReview === 1 ? " is" : "s are"} waiting for your review below.` : ""}</p>}
    </div>
  </section>;
}
