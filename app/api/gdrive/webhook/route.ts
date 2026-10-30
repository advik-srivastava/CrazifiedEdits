import { NextRequest, NextResponse, after } from "next/server";
import { syncFromNotification, verifyDriveNotification } from "@/lib/google-drive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Room for the short debounce plus one folder scan after replying to Google.
export const maxDuration = 60;

/**
 * Google Drive change notifications (changes.watch). Google calls this within seconds of an upload,
 * delete or rename. We only trust calls carrying our channel ID and secret token, reply 200 straight
 * away, then sync in the background. The notification itself carries no file data.
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id") || "";
  const token = request.headers.get("x-goog-channel-token") || "";
  const state = request.headers.get("x-goog-resource-state") || "";
  if (!channelId || !token) return new NextResponse(null, { status: 204 });
  let valid = false;
  try { valid = await verifyDriveNotification(channelId, token); } catch { valid = false; }
  // 204 even for unknown channels: an old channel that's still delivering just goes quiet when it expires.
  if (!valid || state === "sync") return new NextResponse(null, { status: 204 });
  after(syncFromNotification);
  return new NextResponse(null, { status: 204 });
}
