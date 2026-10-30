import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { submitClaim } from "@/lib/claims-server";
import { isConfigured } from "@/lib/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public endpoint: the client reports a payment (with an optional screenshot) from the homepage. */
export async function POST(request: NextRequest) {
  if (!isConfigured()) return NextResponse.json({ error: "The portal isn't connected to its database yet." }, { status: 503 });
  // Refuse submissions that a browser marks as coming from another website. (Some browsers omit
  // Origin on same-site requests, so a missing header is allowed; rate limits handle scripted spam.)
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  let crossSite = request.headers.get("sec-fetch-site") === "cross-site";
  if (origin && host) { try { crossSite ||= new URL(origin).host !== host; } catch { crossSite = true; } }
  if (crossSite) return NextResponse.json({ error: "Please submit the form from the CrazifiedEdits page." }, { status: 403 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "The upload was too large or interrupted. Try a smaller screenshot." }, { status: 413 }); }
  // Honeypot: real visitors never see or fill this field.
  if (String(form.get("website") ?? "")) return NextResponse.json({ ok: true });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  try {
    await submitClaim(form, ip);
    revalidatePath("/"); revalidatePath("/admin");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Your report couldn't be saved.";
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 400 });
  }
}
