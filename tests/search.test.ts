import { describe, expect, it } from "vitest";

import { buildTranscriptSearchQuery } from "@/lib/search";

describe("buildTranscriptSearchQuery", () => {
  it("normalizes a transcript search phrase into lowercase tokens", () => {
    expect(buildTranscriptSearchQuery("  budget review  ")).toEqual([
      "budget",
      "review",
    ]);
  });
});
