import localFont from "next/font/local";

/**
 * Self-hosted fonts (SIL Open Font License, see app/fonts/OFL-*.txt), subset to Latin + ₹.
 * Served from this site: no render-blocking request to Google Fonts, no layout shift, no third-party tracking.
 */
export const dmSans = localFont({
  src: [
    { path: "./fonts/DMSans-400.woff2", weight: "400" },
    { path: "./fonts/DMSans-500.woff2", weight: "500" },
    { path: "./fonts/DMSans-600.woff2", weight: "600" },
    { path: "./fonts/DMSans-700.woff2", weight: "700" },
    { path: "./fonts/DMSans-800.woff2", weight: "800" }
  ],
  variable: "--font-body", display: "swap", fallback: ["system-ui", "Arial", "sans-serif"]
});
export const manrope = localFont({
  src: [
    { path: "./fonts/Manrope-700.woff2", weight: "700" },
    { path: "./fonts/Manrope-800.woff2", weight: "800" }
  ],
  variable: "--font-head", display: "swap", fallback: ["system-ui", "sans-serif"]
});
