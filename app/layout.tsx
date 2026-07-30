import type { Metadata, Viewport } from "next";
import { Geist, Fraunces, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";

import {
  buildOneSignalInitScript,
  getOneSignalAllowedOrigins,
  getOneSignalAppId,
} from "@/lib/onesignal-web-sdk";
import { SITE_NAME, siteOrigin } from "@/lib/site";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
});
const oneSignalAllowedOrigins = getOneSignalAllowedOrigins();
const oneSignalAppId = getOneSignalAppId();
const oneSignalInitScript = oneSignalAppId
  ? buildOneSignalInitScript(oneSignalAppId, oneSignalAllowedOrigins)
  : null;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: "Tape — Every conversation, on the record",
    template: "%s · Tape",
  },
  description:
    "Tape is an AI meeting note taker for bilingual teams, turning Chinese and English conversations into accurate notes and searchable team memory.",
  applicationName: SITE_NAME,
  keywords: [
    "bilingual meeting notes",
    "Chinese English meeting transcription",
    "AI meeting notes without a bot",
    "meeting transcript workspace",
    "MCP meeting notes",
    "self hosted meeting notes",
    "open source meeting transcription",
    "team meeting memory",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        geist.variable,
        fraunces.variable,
        spaceGrotesk.variable,
        ibmPlexMono.variable,
      )}
    >
      <body>
        {children}
        {oneSignalInitScript ? (
          <>
            <Script id="onesignal-init" strategy="beforeInteractive">
              {oneSignalInitScript}
            </Script>
            <Script
              src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
              strategy="afterInteractive"
            />
          </>
        ) : null}
      </body>
    </html>
  );
}
