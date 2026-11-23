import { readFileSync } from "fs";
import { createContext, Script } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  buildOneSignalInitScript,
  getOneSignalAllowedOrigins,
  getOneSignalAppId,
} from "@/lib/onesignal-web-sdk";

describe("OneSignal Web SDK setup", () => {
  it("keeps OneSignal disabled until a deployment configures it", () => {
    expect(getOneSignalAppId({})).toBeNull();
  });

  it("lets deployments override the OneSignal app id", () => {
    expect(
      getOneSignalAppId({
        NEXT_PUBLIC_ONESIGNAL_APP_ID: "custom-app-id\n",
      }),
    ).toBe("custom-app-id");
  });

  it("uses the configured application origin by default", () => {
    expect(
      getOneSignalAllowedOrigins({
        NEXT_PUBLIC_APP_URL: "https://app.example.com/path",
      }),
    ).toEqual(["https://app.example.com"]);
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
      ["https://tape.inevitable.tech"],
    );

    expect(script).toContain("MeetingNoteOneSignalReady");
    expect(script).toContain("window.location.origin");
    expect(script).toContain('"https://tape.inevitable.tech"');
    expect(script).toContain("OneSignal.init");
    expect(script).toContain('"117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef"');
    expect(script).toContain('serviceWorkerPath: "OneSignalSDKWorker.js"');
    expect(script).toContain('scope: "/"');
  });

  it("does not initialize OneSignal on desktop Chrome", async () => {
    const context = runOneSignalInitScript({
      matchMediaMatches: false,
      origin: "https://tape.inevitable.tech",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });

    await expect(context.MeetingNoteOneSignalReady).resolves.toBeNull();
    expect(context.OneSignalDeferred).toEqual([]);
  });

  it("initializes OneSignal on mobile Chrome", async () => {
    const context = runOneSignalInitScript({
      matchMediaMatches: true,
      origin: "https://tape.inevitable.tech",
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    });
    const oneSignal = {
      init: vi.fn().mockResolvedValue(undefined),
    };

    expect(context.OneSignalDeferred).toHaveLength(1);
    await context.OneSignalDeferred[0](oneSignal);

    await expect(context.MeetingNoteOneSignalReady).resolves.toBe(oneSignal);
    expect(oneSignal.init).toHaveBeenCalledWith({
      appId: "app-id",
      serviceWorkerPath: "OneSignalSDKWorker.js",
      serviceWorkerParam: { scope: "/" },
    });
  });

  it("serves one worker that loads OneSignal v16 and Tape offline support", () => {
    const worker = readFileSync("public/OneSignalSDKWorker.js", "utf8");

    expect(worker).toContain(
      'importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");',
    );
    expect(worker).toContain('importScripts("/tape-sw.js");');
  });
});

function runOneSignalInitScript(input: {
  matchMediaMatches: boolean;
  origin: string;
  userAgent: string;
}) {
  const context = {
    console: {
      warn: vi.fn(),
    },
    location: {
      origin: input.origin,
    },
    matchMedia: vi.fn().mockReturnValue({
      matches: input.matchMediaMatches,
    }),
    navigator: {
      userAgent: input.userAgent,
    },
  } as unknown as {
    MeetingNoteOneSignalReady: Promise<unknown>;
    OneSignalDeferred: Array<(oneSignal: unknown) => Promise<void>>;
    window: unknown;
  };

  context.window = context;
  new Script(
    buildOneSignalInitScript("app-id", ["https://tape.inevitable.tech"]),
  ).runInContext(createContext(context));

  return context;
}
