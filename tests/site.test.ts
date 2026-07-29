import { afterEach, describe, expect, it, vi } from "vitest";

import { REPOSITORY_URL, SITE_NAME, siteOrigin, siteUrl } from "@/lib/site";

describe("site metadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured application origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://meetings.example.com");

    expect(siteOrigin()).toBe("https://meetings.example.com");
    expect(siteUrl("/pricing")).toBe("https://meetings.example.com/pricing");
  });

  it("uses the production Tape origin when no origin is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(siteUrl("/")).toBe("https://tape.inevitable.tech/");
  });

  it("exposes stable product metadata", () => {
    expect(SITE_NAME).toBe("Tape");
    expect(REPOSITORY_URL).toBe("https://github.com/glazec/tape");
  });
});
