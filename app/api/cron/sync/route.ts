import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure";
import { syncGoogleDrive } from "@/lib/google-drive";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request: NextRequest) {
  const secret=process.env.CRON_SECRET||"";
  const auth=request.headers.get("authorization")||"";
  if(!secret || !safeEqual(auth,`Bearer ${secret}`)) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const result=await syncGoogleDrive();
    return NextResponse.json({ok:true,imported:result.imported,updated:result.updated,scanned:result.scanned});
  }catch(e) {
    console.error("Google Drive cron sync failed:",e instanceof Error?e.message:"Unknown error");
    return NextResponse.json({ok:false,error:"Sync failed. Review settings in the admin dashboard."},{status:500});
  }
}
