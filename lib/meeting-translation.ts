import { z } from "zod";

import {
  translationLanguageLabels,
  type TranslationLanguage,
} from "@/lib/meeting-translation-language";

type SegmentForTranslation = {
  id: string;
  text: string;
};

export class TranslationResponseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TranslationResponseError";
  }
}

export function buildTranslationMessages(
  segments: SegmentForTranslation[],
  targetLanguage: TranslationLanguage,
) {
  const language = translationLanguageLabels[targetLanguage];

  return [
    {
      role: "system" as const,
      content: `Translate each meeting transcript segment into polished, concise ${language}. Return exactly one nonempty translation for every input segment with the same id. Translate each segment from only its own text. Never move, merge, split, or complete content across segment ids, even when a segment is a short fragment. Translate short fragments and filler minimally instead of returning an empty string. Remove filler words such as 然后, then, um, and uh when they do not change meaning. Preserve speaker intent, team tone, product names, company names, numbers, and tickers.`,
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        segments,
      }),
    },
  ];
}

export function buildChineseTranslationMessages(
  segments: SegmentForTranslation[],
) {
  return buildTranslationMessages(segments, "zh-CN");
}

export function buildTranslationJsonSchema(
  segments: SegmentForTranslation[],
) {
  return {
    type: "json_schema" as const,
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
                  enum: segments.map((segment) => segment.id),
                },
                text: { type: "string", minLength: 1 },
              },
              required: ["id", "text"],
              additionalProperties: false,
            },
            minItems: segments.length,
            maxItems: segments.length,
          },
        },
        required: ["translations"],
        additionalProperties: false,
      },
    },
  };
}

export const buildChineseTranslationJsonSchema = buildTranslationJsonSchema;

export function buildOriginalTranscriptPolishMessages(
  segments: SegmentForTranslation[],
) {
  return [
    {
      role: "system" as const,
      content:
        "Polish meeting transcript segments in their original language. Do not translate. Keep Chinese segments in Chinese and English segments in English. Revise every segment using only the text with that same id. Never move, merge, split, or complete content across segment ids, even when a segment is a short fragment. Remove filler words, hesitation, repeated starts, and phrases that do not carry meaning, such as 然后, then, um, uh, you know, kind of, and sort of. When a speaker corrects a fact or number, keep only the final corrected value, for example 2018, oh 2019 becomes 2019. Make each line concise and smooth while preserving speaker intent, team tone, product names, company names, numbers, tickers, and sentence structure. Keep readable sentences, not bullet points, summaries, or action items. Return only JSON. Do not wrap the JSON in markdown fences.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        segments: segments.map((segment) => ({
          id: segment.id,
          text: segment.text,
        })),
      }),
    },
  ];
}

export function parseTranslationResponse(input: {
  content: string;
  segments: SegmentForTranslation[];
}) {
  try {
    const parsedJson = JSON.parse(extractJsonObject(input.content));
    const parsedObject = z
      .object({
        translations: z.array(
          z.object({
            id: z.string().min(1),
            text: z.string(),
          }),
        ),
      })
      .parse(parsedJson);
    const sourceById = new Map(
      input.segments.map((segment) => [segment.id, segment.text]),
    );
    const seenIds = new Set<string>();
    const translatedById = new Map<string, string>();

    for (const translation of parsedObject.translations) {
      const source = sourceById.get(translation.id);
      const text = translation.text.trim();

      if (source === undefined || seenIds.has(translation.id)) {
        throw new TranslationResponseError(
          "Translation response contained an unknown or duplicate segment id",
        );
      }

      seenIds.add(translation.id);

      if (
        text &&
        (input.segments.length === 1 ||
          isPlausibleTranslationLength(source, text))
      ) {
        translatedById.set(translation.id, text);
      }
    }

    return input.segments.flatMap((segment) => {
      const text = translatedById.get(segment.id);

      return text ? [{ id: segment.id, text }] : [];
    });
  } catch (error) {
    if (error instanceof TranslationResponseError) {
      throw error;
    }

    throw new TranslationResponseError("Invalid translation JSON response", {
      cause: error,
    });
  }
}

export const parseChineseTranslationResponse = parseTranslationResponse;

export function parseOriginalTranscriptPolishResponse(input: {
  content: string;
  segmentIds?: string[];
  segments?: SegmentForTranslation[];
}) {
  const segmentIds =
    input.segments?.map((segment) => segment.id) ?? input.segmentIds ?? [];
  const rows = parseTranscriptTextRows({
    content: input.content,
    segmentIds,
    allowBlankText: true,
  });

  if (!input.segments) {
    return rows;
  }

  const sourceById = new Map(
    input.segments.map((segment) => [segment.id, segment.text]),
  );

  return rows.filter((row) => {
    const source = sourceById.get(row.id);

    return source !== undefined && isPlausiblePolishLength(source, row.text);
  });
}

function parseTranscriptTextRows(input: {
  content: string;
  segmentIds: string[];
  allowBlankText: boolean;
}) {
  const allowedIds = new Set(input.segmentIds);
  const parsedJson = JSON.parse(extractJsonObject(input.content));
  const transcriptRows = getTranscriptRows(parsedJson, {
    allowBlankText: input.allowBlankText,
  });

  return transcriptRows.filter(
    (row) => allowedIds.has(row.id) && Boolean(row.text.trim()),
  );
}

function extractJsonObject(content: string) {
  const trimmedContent = content.trim();

  if (trimmedContent.startsWith("{")) {
    return trimmedContent;
  }

  const fencedJson = trimmedContent.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
  );

  if (fencedJson?.[1]) {
    return fencedJson[1].trim();
  }

  const objectMatch = trimmedContent.match(/\{[\s\S]*\}/);

  if (objectMatch?.[0]) {
    return objectMatch[0];
  }

  return trimmedContent;
}

function isPlausibleTranslationLength(source: string, translated: string) {
  const sourceLength = getMeaningfulLength(source);
  const translatedLength = getMeaningfulLength(translated);

  if (sourceLength === 0 || translatedLength === 0) {
    return false;
  }

  if (
    sourceLength <= 40 &&
    translatedLength > Math.max(24, sourceLength * 4)
  ) {
    return false;
  }

  return !(
    sourceLength >= 100 &&
    translatedLength < Math.max(4, Math.floor(sourceLength * 0.06))
  );
}

function isPlausiblePolishLength(source: string, polished: string) {
  const sourceLength = getMeaningfulLength(source);
  const polishedLength = getMeaningfulLength(polished);

  if (sourceLength === 0 || polishedLength === 0) {
    return false;
  }

  if (sourceLength <= 12) {
    return normalizeShortFragment(source) === normalizeShortFragment(polished);
  }

  if (
    polishedLength >
    Math.max(sourceLength * 3, sourceLength + 30)
  ) {
    return false;
  }

  return !(
    sourceLength >= 120 &&
    polishedLength < Math.max(8, Math.floor(sourceLength * 0.15))
  );
}

function getMeaningfulLength(value: string) {
  return value.replace(/\s+/g, "").length;
}

function normalizeShortFragment(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getTranscriptRows(
  input: unknown,
  options: { allowBlankText: boolean },
) {
  const rowSchema = z.object({
    id: z.string().min(1),
    text: options.allowBlankText
      ? z.string().trim()
      : z.string().trim().min(1),
  });
  const parsedObject = z
    .object({
      translations: z.array(rowSchema).optional(),
      segments: z.array(rowSchema).optional(),
    })
    .parse(input);

  return parsedObject.translations ?? parsedObject.segments ?? [];
}
