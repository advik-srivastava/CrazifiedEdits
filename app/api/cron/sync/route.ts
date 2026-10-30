import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure";
import { syncGoogleDrive } from "@/lib/google-drive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Scheduled polling sync. Vercel Cron sends "Authorization: Bearer $CRON_SECRET". */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const auth = request.headers.get("authorization") || "";
  if (secret.length < 32 || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const r = await syncGoogleDrive("cron");
    return NextResponse.json({ ok: true, skipped: r.skipped, imported: r.imported, updated: r.updated, missing: r.missing, scanned: r.scanned });
  } catch (e) {
    console.error("Google Drive cron sync failed:", e instanceof Error ? e.message : "Unknown error");
    return NextResponse.json({ ok: false, error: "Sync failed. Review settings in the admin dashboard." }, { status: 500 });
  }
}
