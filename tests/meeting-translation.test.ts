import { describe, expect, it } from "vitest";

import {
  buildChineseTranslationMessages,
  buildOriginalTranscriptPolishMessages,
  parseChineseTranslationResponse,
  parseOriginalTranscriptPolishResponse,
} from "@/lib/meeting-translation";

describe("meeting translation", () => {
  it("builds a concise polished Chinese translation prompt from transcript rows", () => {
    expect(
      buildChineseTranslationMessages([
        { id: "segment_1", text: "Hello team" },
        { id: "segment_2", text: "We need to check Solana liquidity." },
      ]),
    ).toEqual([
      {
        role: "system",
        content:
          "Translate meeting transcript segments into polished, concise Chinese. Remove filler words such as 然后 when they do not change meaning. Preserve speaker intent, team tone, product names, company names, numbers, and tickers. Return only JSON. Do not wrap the JSON in markdown fences.",
      },
      {
        role: "user",
        content:
          '{"segments":[{"id":"segment_1","text":"Hello team"},{"id":"segment_2","text":"We need to check Solana liquidity."}]}',
      },
    ]);
  });

  it("builds an original-language polish prompt that handles Chinese meetings", () => {
    expect(
      buildOriginalTranscriptPolishMessages([
        { id: "segment_1", text: "然后我们先看一下 pipeline。" },
        { id: "segment_2", text: "Um we should review the API cost." },
      ]),
    ).toEqual([
      {
        role: "system",
        content:
          "Polish meeting transcript segments in their original language. Do not translate. Keep Chinese segments in Chinese and English segments in English. Remove filler words such as 然后, then, um, and uh when they do not change meaning. Make each line concise and smoother while preserving speaker intent, team tone, product names, company names, numbers, and tickers. Return only JSON. Do not wrap the JSON in markdown fences.",
      },
      {
        role: "user",
        content:
          '{"segments":[{"id":"segment_1","text":"然后我们先看一下 pipeline。"},{"id":"segment_2","text":"Um we should review the API cost."}]}',
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

  it("parses JSON translations wrapped in a markdown code fence", () => {
    expect(
      parseChineseTranslationResponse({
        content:
          '```json\n{"translations":[{"id":"segment_1","text":"你好。"}]}\n```',
        segmentIds: ["segment_1"],
      }),
    ).toEqual([{ id: "segment_1", text: "你好。" }]);
  });

  it("accepts translated rows returned under the input segments key", () => {
    expect(
      parseChineseTranslationResponse({
        content: '{"segments":[{"id":"segment_1","text":"你好。"}]}',
        segmentIds: ["segment_1"],
      }),
    ).toEqual([{ id: "segment_1", text: "你好。" }]);
  });

  it("parses original-language polish rows with the shared response shape", () => {
    expect(
      parseOriginalTranscriptPolishResponse({
        content:
          '{"segments":[{"id":"segment_1","text":"我们先看 pipeline。"},{"id":"unknown","text":"忽略"}]}',
        segmentIds: ["segment_1"],
      }),
    ).toEqual([{ id: "segment_1", text: "我们先看 pipeline。" }]);
  });
});
