import { NextRequest, NextResponse } from "next/server";
import { assertAdminApi } from "@/lib/auth";
import { googleAuthorizeUrl } from "@/lib/google-drive";
import { challenge, randomValue } from "@/lib/secure";
export const runtime="nodejs";
export async function GET(request:NextRequest){
  if(!(await assertAdminApi()))return NextResponse.redirect(new URL("/login",request.url));
  try {
    const state=randomValue(),verifier=randomValue();
    const res=NextResponse.redirect(googleAuthorizeUrl(state,challenge(verifier)));
    const cookie={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/api/gdrive",maxAge:600};
    res.cookies.set("gd_state",state,cookie);res.cookies.set("gd_verifier",verifier,cookie);
    return res;
  }catch(error){
    const message=error instanceof Error?error.message:"Google OAuth is not configured";
    return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(message)}`,request.url));
  }
}
