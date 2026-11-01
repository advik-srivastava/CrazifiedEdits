import type { Metadata, Viewport } from "next";
import "./globals.css";
import { dmSans, manrope } from "./fonts";
export const metadata: Metadata = {
  title:"CrazifiedEdits | Mohit Reel & Payment Ledger",
  description:"CrazifiedEdits by Crazified Studios. Reel deliveries, Google Drive links and Sunday payment ledger for Mohit (@OkayMohit).",
  robots:{index:false,follow:false,noarchive:true}
};
export const viewport: Viewport = { width:"device-width", initialScale:1, viewportFit:"cover", themeColor:"#0d0d11" };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en" className={`${dmSans.variable} ${manrope.variable}`}><body>{children}</body></html>;
}
