import { describe, expect, it } from "vitest";

import {
  buildChineseTranslationJsonSchema,
  buildChineseTranslationMessages,
  buildTranslationMessages,
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
          "Translate each meeting transcript segment into polished, concise Simplified Chinese. Return exactly one nonempty translation for every input segment with the same id. Translate each segment from only its own text. Never move, merge, split, or complete content across segment ids, even when a segment is a short fragment. Translate short fragments and filler minimally instead of returning an empty string. Remove filler words such as 然后, then, um, and uh when they do not change meaning. Preserve speaker intent, team tone, product names, company names, numbers, and tickers.",
      },
      {
        role: "user",
        content:
          '{"segments":[{"id":"segment_1","text":"Hello team"},{"id":"segment_2","text":"We need to check Solana liquidity."}]}',
      },
    ]);
  });

  it("builds a strict id preserving translation schema", () => {
    expect(
      buildChineseTranslationJsonSchema([
        { id: "segment_1", text: "Hello" },
        { id: "segment_2", text: "Goodbye" },
      ]),
    ).toEqual({
      type: "json_schema",
      json_schema: {
        name: "transcript_translation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            translations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    enum: ["segment_1", "segment_2"],
                  },
                  text: { type: "string", minLength: 1 },
                },
                required: ["id", "text"],
                additionalProperties: false,
              },
              minItems: 2,
              maxItems: 2,
            },
          },
          required: ["translations"],
          additionalProperties: false,
        },
      },
    });
  });

  it("builds an English translation prompt when English is selected", () => {
    const [systemMessage] = buildTranslationMessages(
      [{ id: "segment_1", text: "我们讨论下周安排。" }],
      "en",
    );

    expect(systemMessage.content).toContain(
      "Translate each meeting transcript segment into polished, concise English",
    );
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
          "Polish meeting transcript segments in their original language. Do not translate. Keep Chinese segments in Chinese and English segments in English. Revise every segment using only the text with that same id. Never move, merge, split, or complete content across segment ids, even when a segment is a short fragment. Remove filler words, hesitation, repeated starts, and phrases that do not carry meaning, such as 然后, then, um, uh, you know, kind of, and sort of. When a speaker corrects a fact or number, keep only the final corrected value, for example 2018, oh 2019 becomes 2019. Make each line concise and smooth while preserving speaker intent, team tone, product names, company names, numbers, tickers, and sentence structure. Keep readable sentences, not bullet points, summaries, or action items. Return only JSON. Do not wrap the JSON in markdown fences.",
      },
      {
        role: "user",
        content:
          '{"segments":[{"id":"segment_1","text":"然后我们先看一下 pipeline。"},{"id":"segment_2","text":"Um we should review the API cost."}]}',
      },
    ]);
  });

  it("maps explicit translation ids back to segment ids", () => {
    expect(
      parseChineseTranslationResponse({
        content:
          '{"translations":[{"id":"segment_2","text":"检查流动性"},{"id":"segment_1","text":"大家好"}]}',
        segments: [
          { id: "segment_1", text: "Hello team" },
          { id: "segment_2", text: "Check liquidity" },
        ],
      }),
    ).toEqual([
      { id: "segment_1", text: "大家好" },
      { id: "segment_2", text: "检查流动性" },
    ]);
  });

  it("parses JSON translations wrapped in a markdown code fence", () => {
    expect(
      parseChineseTranslationResponse({
        content:
          '```json\n{"translations":[{"id":"segment_1","text":"你好。"}]}\n```',
        segments: [{ id: "segment_1", text: "Hello" }],
      }),
    ).toEqual([{ id: "segment_1", text: "你好。" }]);
  });

  it("preserves valid translations while identifying blank or missing positions", () => {
    expect(
      parseChineseTranslationResponse({
        content:
          '{"translations":[{"id":"segment_1","text":"你好。"},{"id":"segment_2","text":""}]}',
        segments: [
          { id: "segment_1", text: "Hello" },
          { id: "segment_2", text: "Um" },
          { id: "segment_3", text: "Goodbye" },
        ],
      }),
    ).toEqual([{ id: "segment_1", text: "你好。" }]);
  });

  it("rejects implausible content moved onto another segment", () => {
    expect(
      parseChineseTranslationResponse({
        content:
          '{"translations":[{"id":"segment_1","text":"这是一段明显属于相邻长句而不是简短确认词的错误翻译内容。"},{"id":"segment_2","text":"这是需要保留的完整长句翻译。"}]}',
        segments: [
          { id: "segment_1", text: "Yeah." },
          {
            id: "segment_2",
            text:
              "This is a complete long statement that needs to remain attached to its own transcript segment.",
          },
        ],
      }),
    ).toEqual([{ id: "segment_2", text: "这是需要保留的完整长句翻译。" }]);
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

  it("ignores blank original-language polish rows", () => {
    expect(
      parseOriginalTranscriptPolishResponse({
        content:
          '{"segments":[{"id":"segment_1","text":""},{"id":"segment_2","text":"Review API cost."}]}',
        segmentIds: ["segment_1", "segment_2"],
      }),
    ).toEqual([{ id: "segment_2", text: "Review API cost." }]);
  });

  it("falls back when polish moves a long sentence onto a short fragment", () => {
    expect(
      parseOriginalTranscriptPolishResponse({
        content:
          '{"segments":[{"id":"segment_1","text":"This sentence belongs to the next speaker and must not replace a short acknowledgment."}]}',
        segments: [{ id: "segment_1", text: "Yeah." }],
      }),
    ).toEqual([]);
  });
});
