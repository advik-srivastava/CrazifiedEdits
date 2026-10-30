import { NextRequest, NextResponse } from "next/server";
import { assertAdminApi } from "@/lib/auth";
import { safeEqual } from "@/lib/secure";
import { exchangeGoogleCode,storeGoogleConnection } from "@/lib/google-drive";
export const runtime="nodejs";
export async function GET(request:NextRequest){
  if(!(await assertAdminApi()))return NextResponse.redirect(new URL("/login",request.url));
  const state=request.nextUrl.searchParams.get("state")||"";
  const expected=request.cookies.get("gd_state")?.value||"";
  const verifier=request.cookies.get("gd_verifier")?.value||"";
  let feedback="";
  try {
    if(!state||!expected||!safeEqual(state,expected)||!verifier)throw new Error("Google connection session expired. Retry from the admin portal.");
    if(request.nextUrl.searchParams.get("error"))throw new Error("Google Drive consent was cancelled or refused.");
    const code=request.nextUrl.searchParams.get("code");
    if(!code)throw new Error("Google did not return an authorization code.");
    const result=await exchangeGoogleCode(code,verifier);
    if(!result.refresh_token)throw new Error("No offline refresh token returned. Reconnect and grant offline access.");
    await storeGoogleConnection(result.refresh_token,result.access_token!);
    feedback="success=Google%20Drive%20connected.%20Choose%20a%20folder%20and%20sync.";
  }catch(error){feedback=`error=${encodeURIComponent(error instanceof Error?error.message:"Google Drive connection failed")}`;}
  const res=NextResponse.redirect(new URL(`/admin?${feedback}`,request.url));
  res.cookies.set("gd_state","",{path:"/api/gdrive",maxAge:0});
  res.cookies.set("gd_verifier","",{path:"/api/gdrive",maxAge:0});
  return res;
}
