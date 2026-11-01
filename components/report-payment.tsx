"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, Send, X, AlertCircle, ReceiptIndianRupee } from "lucide-react";
import type { WeekBrief } from "@/lib/models";
import { formatINR, prettyDate, sundayFor, todayInIndia } from "@/lib/billing";

const METHODS = ["UPI", "Bank transfer", "Cash", "Other"];
const MAX_UPLOAD = 4 * 1024 * 1024;

/** Shrink phone screenshots before upload: max 1600 px on the long side, JPEG. Keeps uploads fast on mobile data. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob && blob.size < file.size) return blob;
  } catch { /* fall back to the original file */ }
  return file;
}

/**
 * "I've paid" form for the client. The report shows on the week as "awaiting confirmation";
 * the screenshot and reference are only visible to the admin, who confirms it into a payment.
 */
export function ReportPayment({ weeks }: { weeks: WeekBrief[] }) {
  const router = useRouter();
  const today = todayInIndia();
  const current = sundayFor(today);
  // Weeks that have started, newest first; default to the oldest week that still has a balance due.
  const options = useMemo(() => weeks.filter(w => w.starting <= today).sort((a, b) => b.ending.localeCompare(a.ending)), [weeks, today]);
  const firstDue = [...options].reverse().find(w => w.due > 0);
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState(firstDue?.ending || current);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = options.find(w => w.ending === week);

  function pick(f: File | null) {
    setError("");
    if (preview) URL.revokeObjectURL(preview);
    if (f && !f.type.startsWith("image/")) { setError("Choose a screenshot image (JPG or PNG)."); f = null; }
    setFile(f); setPreview(f ? URL.createObjectURL(f) : null);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setState("sending");
    try {
      const data = new FormData(event.currentTarget);
      data.delete("screenshot");
      if (file) {
        const blob = await compress(file);
        if (blob.size > MAX_UPLOAD) throw new Error("The screenshot is too large (max 4 MB). Try cropping it.");
        data.set("screenshot", blob, blob.type === "image/jpeg" ? "screenshot.jpg" : file.name);
      }
      const response = await fetch("/api/payment-claims", { method: "POST", body: data });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Your report couldn't be sent. Please try again.");
      setState("sent"); pick(null);
      router.refresh();
    } catch (e) {
      setState("idle");
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "No connection. Check your internet and try again.");
    }
  }

  if (!open) return <section className="surface report-card" aria-labelledby="report-heading">
    <div className="report-intro"><span className="report-icon"><ReceiptIndianRupee size={22} aria-hidden /></span>
      <div><h2 id="report-heading">Made a payment?</h2><p>Let Advik know. Add the amount and a screenshot; it shows here as <strong>awaiting confirmation</strong> until it&apos;s confirmed.</p></div></div>
    <button type="button" className="button primary report-open" onClick={() => { setOpen(true); setState("idle"); }}><Send size={16} aria-hidden /> Report a payment</button>
  </section>;

  if (state === "sent") return <section className="surface report-card report-done" role="status">
    <CheckCircle2 size={28} aria-hidden />
    <div><h2>Thanks, your payment report was sent</h2><p>It now shows on that week as awaiting confirmation. Once Advik confirms it, the week&apos;s balance updates.</p></div>
    <button type="button" className="button secondary" onClick={() => { setOpen(false); setState("idle"); }}>Done</button>
  </section>;

  return <section className="surface report-card" aria-labelledby="report-form-heading">
    <div className="section-top"><div><div className="eyebrow">PAYMENT REPORT</div><h2 id="report-form-heading">Report a payment</h2><p className="report-sub">Screenshots and references are only visible to Advik.</p></div>
      <button type="button" className="text-button" onClick={() => setOpen(false)} aria-label="Close payment report"><X size={18} aria-hidden /></button></div>
    <form className="edit-grid" onSubmit={submit} noValidate={false}>
      <div className="field wide"><label htmlFor="rp-week">Billing week (Mon – Sun)</label>
        <select id="rp-week" name="week_ending" value={week} onChange={e => setWeek(e.target.value)} required>
          {options.map(w => <option key={w.ending} value={w.ending}>{prettyDate(w.starting)} – {prettyDate(w.ending)}{w.due > 0 ? ` · ${formatINR(w.due)} due` : w.billed > 0 ? " · paid" : ""}</option>)}
        </select>
        {selected && selected.due > 0 && <small className="form-hint">Balance due for this week: <strong>{formatINR(selected.due)}</strong></small>}
      </div>
      <div className="field"><label htmlFor="rp-amount">Amount paid (₹)</label><input id="rp-amount" name="amount" type="number" inputMode="decimal" min="1" step="0.01" placeholder={selected && selected.due > 0 ? String(selected.due) : "e.g. 6000"} required /></div>
      <div className="field"><label htmlFor="rp-date">Date paid</label><input id="rp-date" name="paid_on" type="date" defaultValue={today} max={today} required /></div>
      <div className="field"><label htmlFor="rp-method">Paid by</label><select id="rp-method" name="method" defaultValue="UPI">{METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
      <div className="field"><label htmlFor="rp-ref">UPI / transaction ID <span className="optional">optional</span></label><input id="rp-ref" name="reference" maxLength={120} autoComplete="off" placeholder="e.g. 4123 5678 9012" /></div>
      <div className="field wide"><span className="field-label" id="rp-shot-label">Payment screenshot <span className="optional">recommended</span></span>
        {preview ? <div className="shot-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Selected payment screenshot" />
          <button type="button" className="button subtle" onClick={() => { pick(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={15} aria-hidden /> Remove</button>
        </div> : <label className="shot-drop" htmlFor="rp-shot"><ImagePlus size={22} aria-hidden /><span><strong>Add screenshot</strong><small>JPG or PNG from your gallery</small></span></label>}
        <input ref={fileInput} id="rp-shot" className="sr-only" name="screenshot" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*" aria-labelledby="rp-shot-label" onChange={e => pick(e.target.files?.[0] || null)} />
      </div>
      <div className="field wide"><label htmlFor="rp-note">Note <span className="optional">optional</span></label><input id="rp-note" name="note" maxLength={500} placeholder="Anything Advik should know" /></div>
      {/* Honeypot for bots: hidden from people and screen readers. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp-field" aria-hidden="true" />
      {error && <div className="wide login-error" role="alert"><AlertCircle size={15} aria-hidden /> {error}</div>}
      <div className="wide align-end"><button className="button primary" type="submit" disabled={state === "sending"} aria-busy={state === "sending"}><Send size={16} aria-hidden /> {state === "sending" ? "Sending…" : "Send payment report"}</button></div>
    </form>
  </section>;
}
