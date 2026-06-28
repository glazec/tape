import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";

import {
  buildOneSignalInitScript,
  getOneSignalAllowedOrigins,
  getOneSignalAppId,
} from "@/lib/onesignal-web-sdk";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const oneSignalAllowedOrigins = getOneSignalAllowedOrigins();
const oneSignalInitScript = buildOneSignalInitScript(
  getOneSignalAppId(),
  oneSignalAllowedOrigins,
);

export const metadata: Metadata = {
  title: "Meeting Transcript",
  description: "Team meeting transcript workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        {children}
        <Script id="onesignal-init" strategy="beforeInteractive">
          {oneSignalInitScript}
        </Script>
        <Script
          src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
