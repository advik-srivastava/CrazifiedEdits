import { NextResponse } from "next/server";
import { assertAdminApi } from "@/lib/auth";
import { syncGoogleDrive } from "@/lib/google-drive";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST() {
  if (!(await assertAdminApi())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...await syncGoogleDrive("manual") }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 }); }
}
