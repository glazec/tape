import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";

import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const oneSignalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const oneSignalInitScript = oneSignalAppId
  ? `
window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function(OneSignal) {
  await OneSignal.init({
    appId: ${JSON.stringify(oneSignalAppId)}
  });
});
`
  : null;

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
      {oneSignalInitScript ? (
        <>
          <Script
            src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
            strategy="afterInteractive"
          />
          <Script id="onesignal-init" strategy="afterInteractive">
            {oneSignalInitScript}
          </Script>
        </>
      ) : null}
    </html>
  );
}
