import { z } from "zod";

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

export function buildChineseTranslationMessages(
  segments: SegmentForTranslation[],
) {
  return [
    {
      role: "system" as const,
      content:
        "Translate each meeting transcript text into polished, concise Chinese. Return exactly one nonempty translation for every input text, in the same order. Translate short fragments and filler minimally instead of returning an empty string. Remove filler words such as 然后 when they do not change meaning. Preserve speaker intent, team tone, product names, company names, numbers, and tickers.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        texts: segments.map((segment) => segment.text),
      }),
    },
  ];
}

export function buildChineseTranslationJsonSchema(itemCount: number) {
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
            items: { type: "string", minLength: 1 },
            minItems: itemCount,
            maxItems: itemCount,
          },
        },
        required: ["translations"],
        additionalProperties: false,
      },
    },
  };
}

export function buildOriginalTranscriptPolishMessages(
  segments: SegmentForTranslation[],
) {
  return [
    {
      role: "system" as const,
      content:
        "Polish meeting transcript segments in their original language. Do not translate. Keep Chinese segments in Chinese and English segments in English. Remove filler words, hesitation, repeated starts, and phrases that do not carry meaning, such as 然后, then, um, uh, you know, kind of, and sort of. When a speaker corrects a fact or number, keep only the final corrected value, for example 2018, oh 2019 becomes 2019. Make each line concise and smooth while preserving speaker intent, team tone, product names, company names, numbers, tickers, and sentence structure. Keep readable sentences, not bullet points, summaries, or action items. Return only JSON. Do not wrap the JSON in markdown fences.",
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

export function parseChineseTranslationResponse(input: {
  content: string;
  segments: SegmentForTranslation[];
}) {
  try {
    const parsedJson = JSON.parse(extractJsonObject(input.content));
    const parsedObject = z
      .object({ translations: z.array(z.unknown()) })
      .parse(parsedJson);

    return input.segments.flatMap((segment, index) => {
      const translatedText = parsedObject.translations[index];

      if (typeof translatedText !== "string" || !translatedText.trim()) {
        return [];
      }

      return [{ id: segment.id, text: translatedText.trim() }];
    });
  } catch (error) {
    throw new TranslationResponseError("Invalid translation JSON response", {
      cause: error,
    });
  }
}

export function parseOriginalTranscriptPolishResponse(input: {
  content: string;
  segmentIds: string[];
}) {
  return parseTranscriptTextRows({ ...input, allowBlankText: true });
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
