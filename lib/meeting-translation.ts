import { z } from "zod";

type SegmentForTranslation = {
  id: string;
  text: string;
};

const translationResponseSchema = z.object({
  translations: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().trim().min(1),
    }),
  ),
});

export function buildChineseTranslationMessages(
  segments: SegmentForTranslation[],
) {
  return [
    {
      role: "system" as const,
      content:
        "Translate meeting transcript segments into concise Chinese. Preserve product names, company names, numbers, and tickers. Return only JSON.",
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
  segmentIds: string[];
}) {
  const allowedIds = new Set(input.segmentIds);
  const parsed = translationResponseSchema.parse(JSON.parse(input.content));

  return parsed.translations.filter((translation) =>
    allowedIds.has(translation.id),
  );
}
