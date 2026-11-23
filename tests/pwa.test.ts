import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { SERVICE_WORKER_PATH } from "@/lib/pwa";

describe("PWA manifest", () => {
  const result = manifest();

  it("launches the workspace as a standalone app", () => {
    expect(result.start_url).toBe("/dashboard");
    expect(result.scope).toBe("/");
    expect(result.display).toBe("standalone");
    expect(result.short_name).toBe("Tape");
  });

  it("ships any and maskable icons at 192 and 512", () => {
    const icons = result.icons ?? [];
    for (const purpose of ["any", "maskable"]) {
      const sizes = icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
      expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    }
    for (const icon of icons) {
      expect(() => readFileSync(`public${icon.src}`)).not.toThrow();
    }
  });

  it("offers phone recording as a home screen shortcut", () => {
    expect(result.shortcuts?.map((shortcut) => shortcut.url)).toContain(
      "/meetings/new?source=phone",
    );
  });
});

describe("service worker", () => {
  const worker = readFileSync("public/tape-sw.js", "utf8");

  it("registers the same file OneSignal uses so only one worker owns scope /", () => {
    expect(SERVICE_WORKER_PATH).toBe("/OneSignalSDKWorker.js");
  });

  it("never caches pages or API responses", () => {
    // Navigations go to the network and only fall back to the offline screen.
    expect(worker).toMatch(/request\.mode === "navigate"[\s\S]*networkWithOfflineFallback/);
    expect(worker).not.toMatch(/\/api\//);
    expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
  });

  it("precaches an offline screen that exists", () => {
    expect(worker).toContain('"/offline.html"');
    expect(readFileSync("public/offline.html", "utf8")).toContain("You're offline");
  });
});
