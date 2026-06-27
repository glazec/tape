import { readFileSync } from "fs";

import { describe, expect, it } from "vitest";

import {
  buildOneSignalInitScript,
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

  it("initializes OneSignal with the root service worker file", () => {
    const script = buildOneSignalInitScript(
      "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef",
    );

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
