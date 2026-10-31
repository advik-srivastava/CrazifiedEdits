import { NextRequest, NextResponse } from "next/server";
import { assertAdminApi } from "@/lib/auth";
import { invoicePdf } from "@/lib/invoices-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download an invoice as a PDF. Admin only. Add ?inline=1 to open it in the browser instead of downloading. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertAdminApi())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const pdf = await invoicePdf(id);
    if (!pdf) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const disposition = request.nextUrl.searchParams.get("inline") ? "inline" : "attachment";
    return new NextResponse(Buffer.from(pdf.bytes), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="Invoice-${pdf.number}.pdf"`,
      "Cache-Control": "private, no-store"
    } });
  } catch (error) {
    console.error("Invoice PDF failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The PDF couldn't be created. Please try again." }, { status: 500 });
  }
}
