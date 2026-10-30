"use client";
import { useEffect, useState } from "react";
import { AlertCircle, Sparkles, X } from "lucide-react";

/**
 * Result of the last admin action (or the Google Drive connection), shown floating on screen so it's
 * visible even when the page reloads scrolled to a section (#gdrive, #reels, #payments).
 * Success messages fade after 8 s; errors stay until dismissed. The message is removed from the URL so a
 * refresh doesn't show it again.
 */
export function Toast({ success, error }: { success?: string; error?: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("success") || url.searchParams.has("error")) {
      url.searchParams.delete("success"); url.searchParams.delete("error");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    if (success && !error) { const t = window.setTimeout(() => setOpen(false), 8000); return () => window.clearTimeout(t); }
  }, [success, error]);
  if (!open || (!success && !error)) return null;
  return <div className={`toast-float ${error ? "error-message" : "success-message"}`} role={error ? "alert" : "status"}>
    {error ? <AlertCircle size={18} aria-hidden /> : <Sparkles size={18} aria-hidden />}
    <span>{error || success}</span>
    <button type="button" className="toast-close" onClick={() => setOpen(false)} aria-label="Dismiss message"><X size={18} aria-hidden /></button>
  </div>;
}
