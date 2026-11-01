"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton, confirmSubmit, useOpenRows } from "./forms";
export { SubmitButton };
import { AlertCircle, ArrowUpRight, CheckCircle2, Cloud, ExternalLink, FileVideo, FolderOpen, Link2, PlusCircle, RefreshCcw, Settings2, Shield, X, Clock3, PackageCheck, Copy, CloudOff, History, Pencil, Zap, Wand2 , Trash2, RotateCcw , CalendarClock , GitBranch } from "lucide-react";
import type { Connection, Payment, Reel, Settings, SyncEvent } from "@/lib/models";
import { billingCalendar, durationLabel, formatINR, prettyDate, prettyDateTime, pricingState, reelFee, sundayFor, todayInIndia, uploadDateOf, withinStandardLength, allowedWeeks, BILLED_STATES, reelWeek, shiftISODate } from "@/lib/billing";
import { possibleDuplicates } from "@/lib/sync-plan";
import { canPurge, isDeleted } from "@/lib/reel-delete";
import { paymentMethods } from "@/lib/validation";
import { addManualReel, disconnectGoogleDrive, deleteReel, markAsRevision, markDelivered, moveReelWeek, purgeReel, reconnectNotifications, removePayment, restoreReel, saveAutomation, saveFolder, savePayment, saveReel, syncNow, updatePayment } from "@/app/admin/actions";
import { Empty, Pill, SectionHeading, Status } from "./ui";

function SyncButton() {
  const { pending } = useFormStatus();
  return <button className="button primary" type="submit" disabled={pending} aria-busy={pending}><RefreshCcw size={16} className={pending ? "spin" : ""} aria-hidden />{pending ? "Scanning Google Drive…" : "Sync now"}</button>;
}
const eventTone = { success: "green", error: "red", skipped: "neutral", running: "blue" } as const;
const triggerLabel = { cron: "daily schedule", auto: "dashboard visit", webhook: "instant (Drive change)", manual: "manual" } as const;
export type InstantSync = "on" | "unavailable" | "off";

export function GoogleDrivePanel({ settings, connection, events, syncInProgress, instant }: { settings: Settings; connection: Connection | null; events: SyncEvent[]; syncInProgress: boolean; instant: InstantSync }) {
  return <section className="surface one-drive-card" id="gdrive"><div className="section-top"><SectionHeading eyebrow="CONNECTED STORAGE" title="Google Drive" description="New videos appear automatically as Pending review; nothing is billed until you mark it delivered" /><Pill tone={connection ? "green" : "orange"}>{connection ? "Connected" : "Not connected"}</Pill></div>
    <div className="connect-profile"><span className="drive-icon"><Cloud size={26} aria-hidden /></span><div><strong>{connection?.account_name || "Your Google account"}</strong><small>{connection ? `${connection.account_email || "Connected"} · since ${prettyDateTime(connection.connected_at)}` : "Sign in once to allow read-only syncing"}</small></div>{!connection && <a className="button primary" href="/api/gdrive/connect"><Link2 size={16} aria-hidden />Connect Google Drive</a>}</div>
    <form action={saveFolder} className="folder-form"><label htmlFor="folder">Folder to monitor</label><div className="input-action"><span className="input-prefix"><FolderOpen size={17} aria-hidden /></span><input id="folder" name="folder_path" defaultValue={settings.folder_path} placeholder="https://drive.google.com/drive/folders/..." required aria-describedby="folder-hint" /><SubmitButton variant="secondary">Save folder</SubmitButton></div><small id="folder-hint" className="form-hint">In Google Drive, right-click your reel folder → Share → Copy link, and paste it here. Sub-folders are included.</small></form>
    <div className="sync-footer"><div className="sync-meta"><Clock3 size={15} aria-hidden />{settings.last_sync_at ? `Last synced ${prettyDateTime(settings.last_sync_at)} • ${settings.last_sync_count || 0} videos scanned` : "No sync performed yet"}{syncInProgress && " • sync in progress"}</div><div className="button-row">{connection && <><form action={disconnectGoogleDrive} onSubmit={confirmSubmit("Disconnect Google Drive? Previously logged reels will remain.")}><SubmitButton variant="subtle">Disconnect</SubmitButton></form><form action={syncNow}><SyncButton /></form></>}</div></div>
    {settings.last_sync_error && <div className="small-alert" role="alert"><AlertCircle size={15} aria-hidden />{settings.last_sync_error}</div>}
    {connection && <div className={`instant-status instant-${instant}`}><Zap size={15} aria-hidden /><span>{instant === "on" ? "Instant sync on: new uploads and deletions in Drive appear within about 30 seconds." : instant === "off" ? "Instant sync isn't active yet. It switches on after the next successful sync." : "Instant sync needs the live https:// site address (it's off on localhost). The dashboard still syncs on visits and daily."}</span>{instant === "off" && <form action={reconnectNotifications}><SubmitButton variant="subtle" pendingLabel="Turning on…">Turn on now</SubmitButton></form>}</div>}
    <form action={saveAutomation} className="automation-form">
      <div className="eyebrow"><Wand2 size={13} aria-hidden /> AUTOMATION</div>
      <label className="switch-row"><input type="checkbox" name="auto_deliver" defaultChecked={settings.auto_deliver !== false} /><span><strong>Auto-deliver new uploads</strong><small>Each new video is marked delivered on its upload date and billed (₹600 up to 60 s; longer ones still need a confirmed price). Possible re-uploads stay in Pending review. Only uploads from when this is switched on.</small></span></label>
      <label className="switch-row"><input type="checkbox" name="auto_remove" defaultChecked={settings.auto_remove !== false} /><span><strong>Remove deleted files from the log</strong><small>If a video is deleted, trashed or moved out of the folder, it&apos;s taken off the delivery log and its charge is removed from that week. Payments already received are kept. If the file comes back, the reel is restored.</small></span></label>
      <div className="align-end"><SubmitButton variant="secondary">Save automation</SubmitButton></div>
    </form>
    <p className="drive-note"><Shield size={15} aria-hidden />Read-only Drive access. Also syncs when the dashboard is opened (if the last sync is over 15 minutes old) and once a day. Use Sync now for an immediate check.</p>
    {events.length > 0 && <details className="sync-log"><summary><History size={15} aria-hidden /> Sync history ({events.length} most recent)</summary><ul>{events.map(e => <li key={e.id}><Pill tone={eventTone[e.status]}>{e.status}</Pill><span className="sync-log-when">{prettyDateTime(e.started_at)} · {triggerLabel[e.trigger] ?? e.trigger}</span><span className="sync-log-counts">{e.status === "skipped" ? "Another sync was running" : `${e.imported} new${e.delivered ? ` (${e.delivered} auto-delivered)` : ""} · ${e.removed ? `${e.removed} removed · ` : ""}${e.missing} missing · ${e.scanned} scanned`}</span>{e.error && e.status !== "skipped" && <span className="sync-log-error">{e.error}</span>}</li>)}</ul></details>}
  </section>;
}
export function AddReelForm() {
  return <section className="surface editor-card" id="add"><SectionHeading eyebrow="QUICK ENTRY" title="Log a reel manually" description="Use this when you already have a Google Drive share link" /><form className="edit-grid" action={addManualReel}>
    <div className="field wide"><label htmlFor="add-title">Reel title</label><input id="add-title" name="title" placeholder="e.g. Gut Health – Morning Routine" maxLength={250} required /></div>
    <div className="field wide"><label htmlFor="add-url">Google Drive video link</label><input id="add-url" name="drive_web_url" type="url" inputMode="url" placeholder="https://drive.google.com/file/d/.../view" required /></div>
    <div className="field"><label htmlFor="add-duration">Duration (seconds)</label><input id="add-duration" name="duration_seconds" type="number" inputMode="numeric" min="1" max="86400" step="1" placeholder="48" required /></div>
    <div className="field"><label htmlFor="add-date">Delivery date</label><input id="add-date" name="delivery_date" type="date" defaultValue={todayInIndia()} required /></div>
    <div className="field wide"><label htmlFor="add-notes">Notes <span className="optional">optional, private</span></label><input id="add-notes" name="notes" placeholder="Any notes for this reel..." /></div>
    <div className="wide align-end"><SubmitButton><PlusCircle size={16} aria-hidden /> Add to delivery log</SubmitButton></div></form></section>;
}

type Filter = "all" | "discovered" | "review" | "delivered" | "approved" | "revision" | "cancelled" | "missing" | "deleted";
/** Compact week label: "26 Oct – 1 Nov 2026" (year shown once unless the week crosses New Year). */
const weekRange = (sunday: string) => {
  const monday = shiftISODate(sunday, -6);
  const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return monday.slice(0, 4) === sunday.slice(0, 4) ? `${short(monday)} – ${prettyDate(sunday)}` : `${prettyDate(monday)} – ${prettyDate(sunday)}`;
};
function ReelFlags({ reel, duplicateOf, original }: { reel: Reel; duplicateOf?: Reel; original?: Reel }) {
  const flags: React.ReactNode[] = [];
  if (reel.billing_week_override && reel.delivery_date && !isDeleted(reel)) flags.push(<span key="week" className="reel-flag flag-info"><CalendarClock size={13} aria-hidden />Counts in week {weekRange(reel.billing_week_override)}</span>);
  if (reel.revision_of) flags.push(<span key="revof" className="reel-flag flag-info"><GitBranch size={13} aria-hidden />Revised version{original ? ` of “${original.title}”` : ""}</span>);
  if (duplicateOf) flags.push(<span key="dup" className="reel-flag flag-warn"><Copy size={13} aria-hidden />Possible re-upload of “{duplicateOf.title}”</span>);
  if (pricingState(reel) === "review") flags.push(<span key="price" className="reel-flag flag-warn"><AlertCircle size={13} aria-hidden />Pricing review required</span>);
  const was = reel.status_before_removal ? ` (was ${reel.status_before_removal === "discovered" ? "pending" : reel.status_before_removal})` : "";
  if (reel.removed_by_sync) flags.push(<span key="gone" className="reel-flag flag-muted"><CloudOff size={13} aria-hidden />Deleted automatically: file deleted from Drive{was}</span>);
  else if (reel.deleted_at) flags.push(<span key="del" className="reel-flag flag-muted"><Trash2 size={13} aria-hidden />Deleted by you{was}{reel.drive_missing_at ? " · file also gone from Drive" : ""}</span>);
  else if (reel.drive_missing_at) flags.push(<span key="gone" className="reel-flag flag-muted"><CloudOff size={13} aria-hidden />No longer in Drive folder</span>);
  if (reel.auto_delivered && reel.status !== "cancelled") flags.push(<span key="auto" className="reel-flag flag-info"><Zap size={13} aria-hidden />Auto-delivered</span>);
  if ((reel.revision_count || 0) > 0 && reel.status !== "discovered") flags.push(<span key="rev" className="reel-flag flag-muted"><History size={13} aria-hidden />File changed in Drive after review ({reel.revision_count}×)</span>);
  return flags.length ? <span className="reel-flags">{flags}</span> : null;
}
function ReelEditor({ reel }: { reel: Reel }) {
  const [duration, setDuration] = useState(reel.duration_seconds === null ? "" : String(reel.duration_seconds));
  const n = duration ? Number(duration) : null;
  const needsPrice = !withinStandardLength(n);
  return <form action={saveReel} className="edit-grid"><input type="hidden" name="id" value={reel.id} />
    <div className="field wide"><label htmlFor={`t-${reel.id}`}>Title</label><input id={`t-${reel.id}`} name="title" defaultValue={reel.title} maxLength={250} required /></div>
    <div className="field"><label htmlFor={`s-${reel.id}`}>Status</label><select id={`s-${reel.id}`} name="status" defaultValue={reel.status}><option value="discovered">Pending review (not billed)</option><option value="delivered">Delivered</option><option value="approved">Approved</option><option value="revision">Revision requested</option><option value="cancelled">Cancelled (not billed)</option></select></div>
    <div className="field"><label htmlFor={`d-${reel.id}`}>Duration in seconds</label><input id={`d-${reel.id}`} type="number" inputMode="numeric" name="duration_seconds" min="1" max="86400" step="1" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 60" /></div>
    <div className="field"><label htmlFor={`dd-${reel.id}`}>Delivery date (IST)</label><input id={`dd-${reel.id}`} type="date" name="delivery_date" defaultValue={reel.delivery_date || ""} /></div>
    {reel.delivery_date && <div className="field"><label htmlFor={`w-${reel.id}`}>Counts in billing week</label><select id={`w-${reel.id}`} name="billing_week_override" defaultValue={reel.billing_week_override ?? ""}>
      {allowedWeeks(reel.delivery_date).map((w, i) => <option key={w} value={i === 0 ? "" : w}>{i === 0 ? `Delivery week: ${weekRange(w)}` : `${i === 1 ? "Last week" : `${i} weeks back`}: ${weekRange(w)}`}</option>)}
    </select></div>}
    <div className="field"><label htmlFor={`p-${reel.id}`}>Confirmed price (₹) {!needsPrice && <span className="optional">standard ₹600 applies</span>}</label><input id={`p-${reel.id}`} type="number" inputMode="decimal" name="confirmed_rate_inr" min="1" step="0.01" defaultValue={reel.confirmed_rate_inr ?? ""} placeholder={needsPrice ? "Required to bill this reel" : "Not needed"} disabled={!needsPrice} /></div>
    <div className="field wide"><label htmlFor={`c-${reel.id}`}>Client-viewable link <span className="optional">optional, overrides the Drive link</span></label><input id={`c-${reel.id}`} type="url" inputMode="url" name="client_url" defaultValue={reel.client_url || ""} placeholder="Paste a share link if needed" /></div>
    <div className="field wide"><label htmlFor={`n-${reel.id}`}>Notes <span className="optional">private, never shown to the client</span></label><textarea id={`n-${reel.id}`} rows={2} name="notes" defaultValue={reel.notes || ""} placeholder="Revision details or context" /></div>
    <div className="wide edit-footer"><div className="edit-links">{reel.drive_web_url && <a target="_blank" rel="noopener noreferrer" href={reel.drive_web_url}><ExternalLink size={15} aria-hidden /> Original Drive file</a>}<span className="muted mini-note">{needsPrice ? "Over 60 s or unknown length: billed only at the confirmed price." : "Delivered reels up to 60 s bill at ₹600."}</span></div><SubmitButton>Save changes</SubmitButton></div>
  </form>;
}
/** Count a delivered reel in last week (changes asked for after the week ended), or back in its own week. */
function WeekTools({ reel }: { reel: Reel }) {
  if (!reel.delivery_date || !BILLED_STATES.has(reel.status)) return null;
  const own = sundayFor(reel.delivery_date), counted = reelWeek(reel)!;
  return <form action={moveReelWeek} className="week-tools">
    <input type="hidden" name="id" value={reel.id} />
    <CalendarClock size={16} aria-hidden />
    {counted === own
      ? <><span>Delivered {prettyDate(reel.delivery_date)}. Changes for last week&apos;s work?</span><input type="hidden" name="week" value="previous" /><SubmitButton variant="secondary" pendingLabel="Moving…">Count in last week · {weekRange(shiftISODate(own, -7))}</SubmitButton></>
      : <><span>Counts in week {weekRange(counted)} (delivered {prettyDate(reel.delivery_date)}).</span><input type="hidden" name="week" value="auto" /><SubmitButton variant="subtle" pendingLabel="Moving…">Count in its delivery week instead</SubmitButton></>}
  </form>;
}
/** Mark this upload as the revised version of an earlier reel: it takes that reel's week, the original stops counting. */
function RevisionTools({ reel, candidates, suggested }: { reel: Reel; candidates: Reel[]; suggested?: Reel }) {
  if (reel.revision_of || !candidates.length) return null;
  return <form action={markAsRevision} className="revision-tools" onSubmit={confirmSubmit("Save as a revised version?\n\nThis reel will count in the original's billing week, and the original will be removed from billing (you can restore it from Deleted). The client is charged once.")}>
    <input type="hidden" name="id" value={reel.id} />
    <label htmlFor={`rv-${reel.id}`}><GitBranch size={15} aria-hidden /> Revised version of an earlier reel? <span className="optional">changes the client asked for</span></label>
    <div className="revision-row">
      <select id={`rv-${reel.id}`} name="original_id" defaultValue={suggested?.id ?? ""} required>
        <option value="" disabled>Choose the original reel…</option>
        {candidates.map(c => <option key={c.id} value={c.id}>{c.title.slice(0, 70)} · {c.delivery_date ? prettyDate(c.delivery_date) : "pending"}</option>)}
      </select>
      <SubmitButton variant="secondary" pendingLabel="Saving…">Save as revision</SubmitButton>
    </div>
  </form>;
}
function DeleteReel({ reel }: { reel: Reel }) {
  const fee = reelFee(reel);
  const effect = fee > 0 && reel.delivery_date ? ` Its ${formatINR(fee)} charge comes off the week of ${prettyDate(reel.delivery_date)}.` : "";
  return <form action={deleteReel} className="delete-row" onSubmit={confirmSubmit(`Delete “${reel.title}”?\n\nIt will be removed from the delivery log and billing, and hidden from the client.${effect} Payments aren't changed. You can restore it from the Deleted filter.`)}>
    <input type="hidden" name="id" value={reel.id} />
    <span className="muted mini-note">Removes it from the delivery log and billing. {reel.source === "google_drive" ? "The file in Google Drive isn't touched." : ""}</span>
    <SubmitButton variant="danger" pendingLabel="Deleting…"><Trash2 size={16} aria-hidden /> Delete video</SubmitButton>
  </form>;
}
function DeletedActions({ reel }: { reel: Reel }) {
  return <div className="deleted-actions">
    <p className="muted mini-note">Deleted {reel.deleted_at ? prettyDateTime(reel.deleted_at) : ""}. It isn&apos;t on the delivery log, in billing or visible to the client.</p>
    <div className="quick-actions">
      <form action={restoreReel}><input type="hidden" name="id" value={reel.id} /><SubmitButton pendingLabel="Restoring…"><RotateCcw size={16} aria-hidden /> Restore{reel.status_before_removal ? ` as ${reel.status_before_removal === "discovered" ? "pending review" : reel.status_before_removal}` : ""}</SubmitButton></form>
      {canPurge(reel)
        ? <form action={purgeReel} onSubmit={confirmSubmit(`Permanently delete “${reel.title}”? This can't be undone.`)}><input type="hidden" name="id" value={reel.id} /><SubmitButton variant="danger" pendingLabel="Deleting…"><Trash2 size={16} aria-hidden /> Delete permanently</SubmitButton></form>
        : <span className="muted mini-note">The file is still in your Drive folder, so it&apos;s kept here (deleted) to stop the next sync re-adding it. Delete the file in Drive to allow permanent deletion.</span>}
    </div>
  </div>;
}
export function AdminReelList({ reels }: { reels: Reel[] }) {
  const [filter, setFilter] = useState<Filter>("all"); const [search, setSearch] = useState("");
  const [maxVisible, setMaxVisible] = useState(60);
  const rows = useOpenRows();
  const live = useMemo(() => reels.filter(r => !isDeleted(r)), [reels]);
  const deletedCount = reels.length - live.length;
  const duplicates = useMemo(() => possibleDuplicates(live), [live]);
  const byId = useMemo(() => new Map(reels.map(r => [r.id, r])), [reels]);
  // Originals a revision can replace: live, delivered reels from up to 5 weeks before this one, newest first.
  const revisionCandidates = (reel: Reel) => {
    const ref = reel.delivery_date || uploadDateOf(reel) || todayInIndia();
    const from = shiftISODate(sundayFor(ref), -41);
    return live.filter(r => r.id !== reel.id && r.delivery_date && BILLED_STATES.has(r.status) && r.delivery_date >= from && r.delivery_date <= ref)
      .sort((a, b) => b.delivery_date!.localeCompare(a.delivery_date!)).slice(0, 40);
  };
  const pending = live.filter(r => r.status === "discovered").length;
  const reviewPricing = live.filter(r => pricingState(r) === "review").length;
  const matches = (r: Reel) => filter === "deleted" ? isDeleted(r) : isDeleted(r) ? false : filter === "all" ? true : filter === "review" ? pricingState(r) === "review" : filter === "missing" ? !!r.drive_missing_at : r.status === filter;
  const matching = reels.filter(r => matches(r) && r.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.status === "discovered") - Number(a.status === "discovered"));
  const visible = matching.slice(0, maxVisible);
  return <section className="surface reels-manager" id="reels"><div className="section-top"><SectionHeading eyebrow="REVIEW & DELIVERY" title="Your reel library" description={`${live.length} reels · ${pending} pending review · ${reviewPricing} need a price${deletedCount ? ` · ${deletedCount} deleted` : ""}`} /><Pill tone={pending ? "orange" : "green"}>{pending ? `${pending} pending review` : "All reviewed"}</Pill></div>
    <div className="tools-bar"><input type="search" aria-label="Search reels" className="search-input" placeholder="Search by reel name..." value={search} onChange={e => { setSearch(e.target.value); setMaxVisible(60); }} /><select value={filter} onChange={e => { setFilter(e.target.value as Filter); setMaxVisible(60); }} aria-label="Filter reels"><option value="all">All reels</option><option value="discovered">Pending review</option><option value="review">Pricing review required</option><option value="delivered">Delivered</option><option value="approved">Approved</option><option value="revision">Revision</option><option value="cancelled">Cancelled</option><option value="missing">No longer in Drive</option><option value="deleted">Deleted{deletedCount ? ` (${deletedCount})` : ""}</option></select></div>
    {!visible.length ? <Empty title="No reels found" description={filter === "deleted" ? "Nothing deleted. Deleted reels (by you, or because the file was deleted from Drive) appear here." : reels.length ? "Try another filter or search." : "Connect Google Drive and sync your delivery folder, or add a reel manually."} icon={<FileVideo />} /> : <div className="edit-list">{visible.map(reel => {
      const uploaded = uploadDateOf(reel);
      return <details className={`reel-item ${reel.status === "discovered" ? "reel-pending" : ""} ${isDeleted(reel) ? "reel-deleted" : ""}`} key={reel.id} onToggle={rows.toggle(reel.id)}><summary><span className="file-icon"><FileVideo size={20} aria-hidden /></span><span className="reel-description"><strong title={reel.title}>{reel.title}</strong><small>{uploaded ? `Uploaded ${prettyDate(uploaded)}` : "Upload date unknown"} · {reel.delivery_date ? `Delivered ${prettyDate(reel.delivery_date)}` : "Not delivered"} · {durationLabel(reel.duration_seconds)} · {reel.source === "google_drive" ? "Google Drive" : reel.source === "onedrive" ? "OneDrive (legacy)" : "Manual"}</small><ReelFlags reel={reel} duplicateOf={duplicates.get(reel.id)} original={reel.revision_of ? byId.get(reel.revision_of) : undefined} /></span><span className="reel-value">{pricingState(reel) === "review" ? "—" : formatINR(reelFee(reel))}</span><Status status={isDeleted(reel) ? "deleted" : reel.status} /><span className="edit-action">{isDeleted(reel) ? <>Restore <RotateCcw size={15} aria-hidden /></> : <>Edit <Settings2 size={15} aria-hidden /></>}</span></summary>
        {rows.isOpen(reel.id) && <div className="edit-pane">
          {isDeleted(reel) ? <DeletedActions reel={reel} /> : <>
            {reel.status === "discovered" && <div className="quick-actions"><form action={markDelivered}><input type="hidden" name="id" value={reel.id} /><SubmitButton pendingLabel="Marking…"><PackageCheck size={16} aria-hidden /> Mark delivered today</SubmitButton></form></div>}
            <WeekTools reel={reel} />
            <RevisionTools reel={reel} candidates={revisionCandidates(reel)} suggested={duplicates.get(reel.id)} />
            <ReelEditor reel={reel} />
            <DeleteReel reel={reel} />
          </>}
        </div>}
      </details>;
    })}{matching.length > visible.length && <div className="load-more-reels"><button className="button secondary" type="button" onClick={() => setMaxVisible(n => n + 60)}>Show 60 more ({matching.length - visible.length} remaining)</button></div>}</div>}</section>;
}

/** Weeks a payment can be for: every week that has started (newest first), plus the week already chosen. */
function WeekOptions({ selected }: { selected?: string }) {
  const today = todayInIndia();
  const weeks = billingCalendar().filter(w => w.starting <= today || w.ending === selected).reverse();
  return <>{weeks.map(item => <option value={item.ending} key={item.ending}>{prettyDate(item.starting)} – {prettyDate(item.ending)}</option>)}</>;
}
function MethodOptions() {
  return <><option value="">Not specified</option>{paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}</>;
}
function PaymentFields({ p, prefix }: { p?: Payment; prefix: string }) {
  const [week, setWeek] = useState(p?.week_ending || sundayFor(todayInIndia()));
  return <>
    <div className="field"><label htmlFor={`${prefix}-week`}>Billing week (Mon – Sun)</label><select id={`${prefix}-week`} name="week_ending" required value={week} onChange={e => setWeek(e.target.value)}><WeekOptions selected={week} /></select></div>
    <div className="field"><label htmlFor={`${prefix}-amount`}>Amount received (₹)</label><input id={`${prefix}-amount`} type="number" inputMode="decimal" name="amount" min="0.01" step="0.01" defaultValue={p ? Number(p.amount) : undefined} placeholder="e.g. 6000" required /></div>
    <div className="field"><label htmlFor={`${prefix}-paid`}>Payment date</label><input id={`${prefix}-paid`} type="date" name="paid_on" defaultValue={p?.paid_on || todayInIndia()} required /></div>
    <div className="field"><label htmlFor={`${prefix}-method`}>Method <span className="optional">optional</span></label><select id={`${prefix}-method`} name="method" defaultValue={p?.method || ""}><MethodOptions /></select></div>
    <div className="field wide"><label htmlFor={`${prefix}-note`}>Reference <span className="optional">optional, private</span></label><input id={`${prefix}-note`} name="note" defaultValue={p?.note || ""} placeholder="UPI ref / bank remarks" maxLength={500} /></div>
  </>;
}
export function PaymentEntry({ payments }: { payments: Payment[] }) {
  const [shown, setShown] = useState(10);
  const payRows = useOpenRows();
  return <section className="surface editor-card" id="payments"><SectionHeading eyebrow="SETTLEMENTS" title="Record a payment" description="Allocate each payment to a billing week. Partial and multiple payments per week are supported." /><form className="edit-grid" action={savePayment}><PaymentFields prefix="new" /><div className="wide align-end"><SubmitButton><CheckCircle2 size={16} aria-hidden /> Record payment</SubmitButton></div></form>
    {payments.length > 0 && <div className="admin-payments"><div className="eyebrow">RECORDED PAYMENTS</div>{payments.slice(0, shown).map(p => <details className="admin-payment-item" key={p.id} onToggle={payRows.toggle(p.id)}><summary className="admin-payment-row"><span><strong>{formatINR(Number(p.amount))}</strong><small>Paid {prettyDate(p.paid_on)} • Week ending {prettyDate(p.week_ending)}{p.method ? ` • ${p.method}` : ""}</small></span><span className="edit-action"><Pencil size={14} aria-hidden /> Correct</span></summary>
      {payRows.isOpen(p.id) && <div className="edit-pane"><form className="edit-grid" action={updatePayment}><input type="hidden" name="id" value={p.id} /><PaymentFields p={p} prefix={`p-${p.id}`} /><div className="wide edit-footer"><span className="muted mini-note">Corrections recalculate that week&apos;s balance.</span><SubmitButton>Save correction</SubmitButton></div></form>
        <form action={removePayment} onSubmit={confirmSubmit("Delete this payment entry? This can't be undone.")} className="payment-delete"><input type="hidden" name="id" value={p.id} /><SubmitButton variant="subtle" pendingLabel="Deleting…"><X size={15} aria-hidden /> Delete payment</SubmitButton></form></div>}
    </details>)}{payments.length > shown && <button type="button" className="button secondary load-more-payments" onClick={() => setShown(n => n + 20)}>Show more ({payments.length - shown} remaining)</button>}</div>}
  </section>;
}
export function ClientLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="client-link"><div><strong>Public client dashboard link</strong><small>Anyone with this link can view delivered reels and payments. No login needed, and nothing can be edited.</small></div><div className="client-link-controls"><input aria-label="Client URL" value={url || "Public URL unavailable"} readOnly /><button type="button" className="button secondary" disabled={!url} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>{copied ? "Copied!" : "Copy link"}</button>{url && <a className="button subtle" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open client view"><ArrowUpRight size={17} aria-hidden /></a>}</div></div>;
}
