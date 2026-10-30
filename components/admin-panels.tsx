"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowUpRight, CheckCircle2, Cloud, ExternalLink, FileVideo, FolderOpen, Link2, PlusCircle, RefreshCcw, Settings2, Shield, X, Clock3, PackageCheck, Copy, CloudOff, History, Pencil } from "lucide-react";
import type { Connection, Payment, Reel, Settings, SyncEvent } from "@/lib/models";
import { billingCalendar, durationLabel, formatINR, prettyDate, prettyDateTime, pricingState, reelFee, sundayFor, todayInIndia, uploadDateOf, withinStandardLength } from "@/lib/billing";
import { possibleDuplicates } from "@/lib/sync-plan";
import { paymentMethods } from "@/lib/validation";
import { addManualReel, disconnectGoogleDrive, markDelivered, removePayment, removeReel, saveFolder, savePayment, saveReel, syncNow, updatePayment } from "@/app/admin/actions";
import { Empty, Pill, SectionHeading, Status } from "./ui";

export function SubmitButton({ children, variant = "primary", pendingLabel = "Saving…" }: { children: React.ReactNode, variant?: "primary" | "secondary" | "subtle", pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button className={`button ${variant}`} type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : children}</button>;
}
function SyncButton() {
  const { pending } = useFormStatus();
  return <button className="button primary" type="submit" disabled={pending} aria-busy={pending}><RefreshCcw size={16} className={pending ? "spin" : ""} aria-hidden />{pending ? "Scanning Google Drive…" : "Sync now"}</button>;
}
function confirmSubmit(message: string) {
  return (e: React.FormEvent<HTMLFormElement>) => { if (!confirm(message)) e.preventDefault(); };
}
const eventTone = { success: "green", error: "red", skipped: "neutral", running: "blue" } as const;

export function GoogleDrivePanel({ settings, connection, events, syncInProgress }: { settings: Settings; connection: Connection | null; events: SyncEvent[]; syncInProgress: boolean }) {
  return <section className="surface one-drive-card" id="gdrive"><div className="section-top"><SectionHeading eyebrow="CONNECTED STORAGE" title="Google Drive" description="New videos appear automatically as Pending review; nothing is billed until you mark it delivered" /><Pill tone={connection ? "green" : "orange"}>{connection ? "Connected" : "Not connected"}</Pill></div>
    <div className="connect-profile"><span className="drive-icon"><Cloud size={26} aria-hidden /></span><div><strong>{connection?.account_name || "Your Google account"}</strong><small>{connection ? `${connection.account_email || "Connected"} · since ${prettyDateTime(connection.connected_at)}` : "Sign in once to allow read-only syncing"}</small></div>{!connection && <a className="button primary" href="/api/gdrive/connect"><Link2 size={16} aria-hidden />Connect Google Drive</a>}</div>
    <form action={saveFolder} className="folder-form"><label htmlFor="folder">Folder to monitor</label><div className="input-action"><span className="input-prefix"><FolderOpen size={17} aria-hidden /></span><input id="folder" name="folder_path" defaultValue={settings.folder_path} placeholder="https://drive.google.com/drive/folders/..." required aria-describedby="folder-hint" /><SubmitButton variant="secondary">Save folder</SubmitButton></div><small id="folder-hint" className="form-hint">In Google Drive, right-click your reel folder → Share → Copy link, and paste it here. Sub-folders are included.</small></form>
    <div className="sync-footer"><div className="sync-meta"><Clock3 size={15} aria-hidden />{settings.last_sync_at ? `Last synced ${prettyDateTime(settings.last_sync_at)} • ${settings.last_sync_count || 0} videos scanned` : "No sync performed yet"}{syncInProgress && " • sync in progress"}</div><div className="button-row">{connection && <><form action={disconnectGoogleDrive} onSubmit={confirmSubmit("Disconnect Google Drive? Previously logged reels will remain.")}><SubmitButton variant="subtle">Disconnect</SubmitButton></form><form action={syncNow}><SyncButton /></form></>}</div></div>
    {settings.last_sync_error && <div className="small-alert" role="alert"><AlertCircle size={15} aria-hidden />{settings.last_sync_error}</div>}
    <p className="drive-note"><Shield size={15} aria-hidden />Read-only access. Scheduled sync runs automatically; use Sync now for an immediate check.</p>
    {events.length > 0 && <details className="sync-log"><summary><History size={15} aria-hidden /> Sync history ({events.length} most recent)</summary><ul>{events.map(e => <li key={e.id}><Pill tone={eventTone[e.status]}>{e.status}</Pill><span className="sync-log-when">{prettyDateTime(e.started_at)} · {e.trigger === "cron" ? "scheduled" : "manual"}</span><span className="sync-log-counts">{e.status === "skipped" ? "Another sync was running" : `${e.imported} new · ${e.updated} refreshed · ${e.missing} removed · ${e.scanned} scanned`}</span>{e.error && e.status === "error" && <span className="sync-log-error">{e.error}</span>}</li>)}</ul></details>}
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

type Filter = "all" | "discovered" | "review" | "delivered" | "approved" | "revision" | "cancelled" | "missing";
function ReelFlags({ reel, duplicateOf }: { reel: Reel; duplicateOf?: Reel }) {
  const flags: React.ReactNode[] = [];
  if (duplicateOf) flags.push(<span key="dup" className="reel-flag flag-warn"><Copy size={13} aria-hidden />Possible re-upload of “{duplicateOf.title}”</span>);
  if (pricingState(reel) === "review") flags.push(<span key="price" className="reel-flag flag-warn"><AlertCircle size={13} aria-hidden />Pricing review required</span>);
  if (reel.drive_missing_at) flags.push(<span key="gone" className="reel-flag flag-muted"><CloudOff size={13} aria-hidden />No longer in Drive folder</span>);
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
    <div className="field"><label htmlFor={`p-${reel.id}`}>Confirmed price (₹) {!needsPrice && <span className="optional">standard ₹600 applies</span>}</label><input id={`p-${reel.id}`} type="number" inputMode="decimal" name="confirmed_rate_inr" min="1" step="0.01" defaultValue={reel.confirmed_rate_inr ?? ""} placeholder={needsPrice ? "Required to bill this reel" : "Not needed"} disabled={!needsPrice} /></div>
    <div className="field wide"><label htmlFor={`c-${reel.id}`}>Client-viewable link <span className="optional">optional, overrides the Drive link</span></label><input id={`c-${reel.id}`} type="url" inputMode="url" name="client_url" defaultValue={reel.client_url || ""} placeholder="Paste a share link if needed" /></div>
    <div className="field wide"><label htmlFor={`n-${reel.id}`}>Notes <span className="optional">private, never shown to the client</span></label><textarea id={`n-${reel.id}`} rows={2} name="notes" defaultValue={reel.notes || ""} placeholder="Revision details or context" /></div>
    <div className="wide edit-footer"><div className="edit-links">{reel.drive_web_url && <a target="_blank" rel="noopener noreferrer" href={reel.drive_web_url}><ExternalLink size={15} aria-hidden /> Original Drive file</a>}<span className="muted mini-note">{needsPrice ? "Over 60 s or unknown length: billed only at the confirmed price." : "Delivered reels up to 60 s bill at ₹600."}</span></div><SubmitButton>Save changes</SubmitButton></div>
  </form>;
}
export function AdminReelList({ reels }: { reels: Reel[] }) {
  const [filter, setFilter] = useState<Filter>("all"); const [search, setSearch] = useState("");
  const [maxVisible, setMaxVisible] = useState(60);
  const duplicates = useMemo(() => possibleDuplicates(reels), [reels]);
  const pending = reels.filter(r => r.status === "discovered").length;
  const reviewPricing = reels.filter(r => pricingState(r) === "review").length;
  const matches = (r: Reel) => filter === "all" ? true : filter === "review" ? pricingState(r) === "review" : filter === "missing" ? !!r.drive_missing_at : r.status === filter;
  const matching = reels.filter(r => matches(r) && r.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.status === "discovered") - Number(a.status === "discovered"));
  const visible = matching.slice(0, maxVisible);
  return <section className="surface reels-manager" id="reels"><div className="section-top"><SectionHeading eyebrow="REVIEW & DELIVERY" title="Your reel library" description={`${reels.length} reels · ${pending} pending review · ${reviewPricing} need a price`} /><Pill tone={pending ? "orange" : "green"}>{pending ? `${pending} pending review` : "All reviewed"}</Pill></div>
    <div className="tools-bar"><input type="search" aria-label="Search reels" className="search-input" placeholder="Search by reel name..." value={search} onChange={e => { setSearch(e.target.value); setMaxVisible(60); }} /><select value={filter} onChange={e => { setFilter(e.target.value as Filter); setMaxVisible(60); }} aria-label="Filter reels"><option value="all">All reels</option><option value="discovered">Pending review</option><option value="review">Pricing review required</option><option value="delivered">Delivered</option><option value="approved">Approved</option><option value="revision">Revision</option><option value="cancelled">Cancelled</option><option value="missing">No longer in Drive</option></select></div>
    {!visible.length ? <Empty title="No reels found" description={reels.length ? "Try another filter or search." : "Connect Google Drive and sync your delivery folder, or add a reel manually."} icon={<FileVideo />} /> : <div className="edit-list">{visible.map(reel => {
      const uploaded = uploadDateOf(reel);
      return <details className={`reel-item ${reel.status === "discovered" ? "reel-pending" : ""}`} key={reel.id}><summary><span className="file-icon"><FileVideo size={20} aria-hidden /></span><span className="reel-description"><strong title={reel.title}>{reel.title}</strong><small>{uploaded ? `Uploaded ${prettyDate(uploaded)}` : "Upload date unknown"} · {reel.delivery_date ? `Delivered ${prettyDate(reel.delivery_date)}` : "Not delivered"} · {durationLabel(reel.duration_seconds)} · {reel.source === "google_drive" ? "Google Drive" : reel.source === "onedrive" ? "OneDrive (legacy)" : "Manual"}</small><ReelFlags reel={reel} duplicateOf={duplicates.get(reel.id)} /></span><span className="reel-value">{pricingState(reel) === "review" ? "—" : formatINR(reelFee(reel))}</span><Status status={reel.status} /><span className="edit-action">Edit <Settings2 size={15} aria-hidden /></span></summary>
        <div className="edit-pane">
          {reel.status === "discovered" && <div className="quick-actions"><form action={markDelivered}><input type="hidden" name="id" value={reel.id} /><SubmitButton pendingLabel="Marking…"><PackageCheck size={16} aria-hidden /> Mark delivered today</SubmitButton></form><form action={removeReel} onSubmit={confirmSubmit(reel.source === "manual" ? "Delete this manual reel?" : "Cancel this reel? It won't be billed, and future syncs won't re-add it.")}><input type="hidden" name="id" value={reel.id} /><SubmitButton variant="subtle" pendingLabel="Removing…"><X size={16} aria-hidden /> {reel.source === "manual" ? "Delete" : "Not a deliverable"}</SubmitButton></form></div>}
          <ReelEditor reel={reel} />
        </div>
      </details>;
    })}{matching.length > visible.length && <div className="load-more-reels"><button className="button secondary" type="button" onClick={() => setMaxVisible(n => n + 60)}>Show 60 more ({matching.length - visible.length} remaining)</button></div>}</div>}</section>;
}

function WeekOptions() {
  return <>{billingCalendar().map(item => <option value={item.ending} key={item.ending}>{prettyDate(item.starting)} – {prettyDate(item.ending)}</option>)}</>;
}
function MethodOptions() {
  return <><option value="">Not specified</option>{paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}</>;
}
function PaymentFields({ p, prefix }: { p?: Payment; prefix: string }) {
  const [week, setWeek] = useState(p?.week_ending || sundayFor(todayInIndia()));
  return <>
    <div className="field"><label htmlFor={`${prefix}-week`}>Billing week (Mon – Sun)</label><select id={`${prefix}-week`} name="week_ending" required value={week} onChange={e => setWeek(e.target.value)}><WeekOptions /></select></div>
    <div className="field"><label htmlFor={`${prefix}-amount`}>Amount received (₹)</label><input id={`${prefix}-amount`} type="number" inputMode="decimal" name="amount" min="0.01" step="0.01" defaultValue={p ? Number(p.amount) : undefined} placeholder="e.g. 6000" required /></div>
    <div className="field"><label htmlFor={`${prefix}-paid`}>Payment date</label><input id={`${prefix}-paid`} type="date" name="paid_on" defaultValue={p?.paid_on || todayInIndia()} required /></div>
    <div className="field"><label htmlFor={`${prefix}-method`}>Method <span className="optional">optional</span></label><select id={`${prefix}-method`} name="method" defaultValue={p?.method || ""}><MethodOptions /></select></div>
    <div className="field wide"><label htmlFor={`${prefix}-note`}>Reference <span className="optional">optional, private</span></label><input id={`${prefix}-note`} name="note" defaultValue={p?.note || ""} placeholder="UPI ref / bank remarks" maxLength={500} /></div>
  </>;
}
export function PaymentEntry({ payments }: { payments: Payment[] }) {
  const [shown, setShown] = useState(10);
  return <section className="surface editor-card" id="payments"><SectionHeading eyebrow="SETTLEMENTS" title="Record a payment" description="Allocate each payment to a billing week. Partial and multiple payments per week are supported." /><form className="edit-grid" action={savePayment}><PaymentFields prefix="new" /><div className="wide align-end"><SubmitButton><CheckCircle2 size={16} aria-hidden /> Record payment</SubmitButton></div></form>
    {payments.length > 0 && <div className="admin-payments"><div className="eyebrow">RECORDED PAYMENTS</div>{payments.slice(0, shown).map(p => <details className="admin-payment-item" key={p.id}><summary className="admin-payment-row"><span><strong>{formatINR(Number(p.amount))}</strong><small>Paid {prettyDate(p.paid_on)} • Week ending {prettyDate(p.week_ending)}{p.method ? ` • ${p.method}` : ""}</small></span><span className="edit-action"><Pencil size={14} aria-hidden /> Correct</span></summary>
      <div className="edit-pane"><form className="edit-grid" action={updatePayment}><input type="hidden" name="id" value={p.id} /><PaymentFields p={p} prefix={`p-${p.id}`} /><div className="wide edit-footer"><span className="muted mini-note">Corrections recalculate that week&apos;s balance.</span><SubmitButton>Save correction</SubmitButton></div></form>
        <form action={removePayment} onSubmit={confirmSubmit("Delete this payment entry? This can't be undone.")} className="payment-delete"><input type="hidden" name="id" value={p.id} /><SubmitButton variant="subtle" pendingLabel="Deleting…"><X size={15} aria-hidden /> Delete payment</SubmitButton></form></div>
    </details>)}{payments.length > shown && <button type="button" className="button secondary load-more-payments" onClick={() => setShown(n => n + 20)}>Show more ({payments.length - shown} remaining)</button>}</div>}
  </section>;
}
export function ClientLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="client-link"><div><strong>Public client dashboard link</strong><small>Anyone with this link can view delivered reels and payments. No login needed, and nothing can be edited.</small></div><div className="client-link-controls"><input aria-label="Client URL" value={url || "Public URL unavailable"} readOnly /><button type="button" className="button secondary" disabled={!url} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>{copied ? "Copied!" : "Copy link"}</button>{url && <a className="button subtle" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open client view"><ArrowUpRight size={17} aria-hidden /></a>}</div></div>;
}
