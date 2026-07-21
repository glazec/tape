import { afterEach, describe, expect, it, vi } from "vitest";

import { searchWebWithExa } from "@/lib/vendors/exa";

describe("Exa vendor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports non successful API responses", async () => {
    vi.stubEnv("EXA_API_KEY", "exa_key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(null, { status: 429, statusText: "Too Many Requests" }),
    ));

    await expect(searchWebWithExa("latest crypto news")).rejects.toThrow(
      "Exa answer failed with 429 Too Many Requests",
    );
  });
});
