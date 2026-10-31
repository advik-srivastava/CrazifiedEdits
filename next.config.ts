import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The invoice PDF route reads its fonts and logo from disk; make sure Vercel ships them with it.
  outputFileTracingIncludes: { "/api/invoices/[id]/pdf": ["./assets/fonts/**", "./public/images/crazified-logo.png"] },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
    ] }];
  }
};
export default nextConfig;
