import { readFileSync } from "fs";

import { describe, expect, it } from "vitest";

import {
  buildOneSignalInitScript,
  getOneSignalAllowedOrigins,
  getOneSignalAppId,
} from "@/lib/onesignal-web-sdk";

describe("OneSignal Web SDK setup", () => {
  it("uses the IOSG OneSignal app id by default", () => {
    expect(getOneSignalAppId({})).toBe(
      "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef",
    );
  });

  it("lets deployments override the OneSignal app id", () => {
    expect(
      getOneSignalAppId({
        NEXT_PUBLIC_ONESIGNAL_APP_ID: "custom-app-id\n",
      }),
    ).toBe("custom-app-id");
  });

  it("uses the production OneSignal origin by default", () => {
    expect(getOneSignalAllowedOrigins({})).toEqual([
      "https://meeting-note-swart.vercel.app",
    ]);
  });

  it("normalizes configured OneSignal origins", () => {
    expect(
      getOneSignalAllowedOrigins({
        NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS:
          " https://example.com/path , http://localhost:3020/ ",
      }),
    ).toEqual(["https://example.com", "http://localhost:3020"]);
  });

  it("initializes OneSignal with the root service worker file", () => {
    const script = buildOneSignalInitScript(
      "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef",
      ["https://meeting-note-swart.vercel.app"],
    );

    expect(script).toContain("MeetingNoteOneSignalReady");
    expect(script).toContain("window.location.origin");
    expect(script).toContain('"https://meeting-note-swart.vercel.app"');
    expect(script).toContain("OneSignal.init");
    expect(script).toContain('"117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef"');
    expect(script).toContain('serviceWorkerPath: "OneSignalSDKWorker.js"');
    expect(script).toContain('scope: "/"');
  });

  it("serves the OneSignal v16 service worker from public assets", () => {
    expect(readFileSync("public/OneSignalSDKWorker.js", "utf8").trim()).toBe(
      'importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");',
    );
  });
});
