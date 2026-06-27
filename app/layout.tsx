import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";

import {
  buildOneSignalInitScript,
  getOneSignalAppId,
} from "@/lib/onesignal-web-sdk";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const oneSignalInitScript = buildOneSignalInitScript(getOneSignalAppId());

export const metadata: Metadata = {
  title: "Meeting Transcript",
  description: "Team meeting transcript workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
      <Script
        src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
        strategy="afterInteractive"
      />
      <Script id="onesignal-init" strategy="afterInteractive">
        {oneSignalInitScript}
      </Script>
    </html>
  );
}
