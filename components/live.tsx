"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { msUntilIndiaMidnight } from "@/lib/billing";

/**
 * Keeps the dashboard current without a redeploy and without calling Google Drive:
 * re-renders from the database every `intervalMs` while the tab is visible, when the
 * tab comes back into focus or the connection returns, and just after midnight IST so
 * Today/Yesterday roll over. Skips a refresh while someone is typing in a form.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const busy = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    };
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine && !busy()) router.refresh(); };
    const timer = window.setInterval(refresh, intervalMs);
    let midnight: number;
    const scheduleMidnight = () => {
      midnight = window.setTimeout(() => { router.refresh(); scheduleMidnight(); }, msUntilIndiaMidnight() + 2_000);
    };
    scheduleMidnight();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer); window.clearTimeout(midnight);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [router, intervalMs]);
  return null;
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback); window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
  if (!offline) return null;
  return <div className="offline-banner" role="status"><WifiOff size={16} aria-hidden />You&apos;re offline. Figures shown are from your last connection and will update when you&apos;re back online.</div>;
}
