import { notFound, redirect } from "next/navigation";
import { safeEqual } from "@/lib/secure";
/** Legacy share links redirect to the new public-first homepage. */
export default async function LegacyClientPage({params}:{params:Promise<{token:string}>}) {
  const {token} = await params;
  const secret = process.env.PUBLIC_CLIENT_TOKEN || "";
  if (secret.length < 40 || !safeEqual(token, secret)) notFound();
  redirect("/");
}
