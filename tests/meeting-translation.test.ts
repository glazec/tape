import { describe, expect, it } from "vitest";

import {
  buildChineseTranslationMessages,
  parseChineseTranslationResponse,
} from "@/lib/meeting-translation";

describe("meeting translation", () => {
  it("builds a compact Chinese translation prompt from transcript rows", () => {
    expect(
      buildChineseTranslationMessages([
        { id: "segment_1", text: "Hello team" },
        { id: "segment_2", text: "We need to check Solana liquidity." },
      ]),
    ).toEqual([
      {
        role: "system",
        content:
          "Translate meeting transcript segments into concise Chinese. Preserve product names, company names, numbers, and tickers. Return only JSON.",
      },
      {
        role: "user",
        content:
          '{"segments":[{"id":"segment_1","text":"Hello team"},{"id":"segment_2","text":"We need to check Solana liquidity."}]}',
      },
    ]);
  });

  it("parses valid JSON translations and ignores unknown segment ids", () => {
    expect(
      parseChineseTranslationResponse({
        content:
          '{"translations":[{"id":"segment_1","text":"大家好"},{"id":"unknown","text":"忽略"}]}',
        segmentIds: ["segment_1"],
      }),
    ).toEqual([{ id: "segment_1", text: "大家好" }]);
  });
});
