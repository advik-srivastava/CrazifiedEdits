import type { MetadataRoute } from "next";
/** Hidden from search engines. Google's push-notification sender (APIs-Google) honours robots.txt,
 * so it's allowed to reach the Drive webhook and nothing else. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "APIs-Google", allow: "/api/gdrive/webhook", disallow: "/" }, { userAgent: "*", disallow: "/" }] };
}
