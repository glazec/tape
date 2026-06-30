import { z } from "zod";

import {
  buildChineseTranslationMessages,
  buildOriginalTranscriptPolishMessages,
  parseChineseTranslationResponse,
  parseOriginalTranscriptPolishResponse,
} from "@/lib/meeting-translation";

const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().url().optional(),
);

const openRouterEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().trim().min(1),
  OPENROUTER_MODEL: z.string().trim().min(1),
  NEXT_PUBLIC_APP_URL: optionalUrl,
});

const openRouterResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z
        .object({
          content: z.string().optional().nullable(),
        })
        .optional()
        .nullable(),
    }),
  ),
});
export const TRANSLATION_BATCH_SIZE = 10;
const TRANSLATION_BATCH_CHARACTER_LIMIT = 1800;

export async function generateOpenRouterChatReply(input: {
  question: string;
  participantName?: string | null;
}) {
  const env = openRouterEnvSchema.parse(process.env);
  const participantName = input.participantName?.trim() || "A participant";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(env.NEXT_PUBLIC_APP_URL
        ? { "HTTP-Referer": env.NEXT_PUBLIC_APP_URL }
        : {}),
      "X-Title": "Meeting Note",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are IOSG Old Friend, a concise meeting assistant inside a live meeting chat. Answer the user's question directly. If the answer requires live transcript or private app data you do not have, say that briefly. Keep the answer under 700 characters.",
        },
        {
          role: "user",
          content: `${participantName} asked in the meeting chat:\n${input.question}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 240,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter chat completion failed with ${response.status} ${response.statusText}`,
    );
  }

  const parsed = openRouterResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter chat completion response missing content");
  }

  return content;
}

export async function translateTranscriptSegmentsToChinese(
  segments: Array<{ id: string; text: string }>,
  options: { batchSize?: number } = {},
) {
  if (segments.length === 0) {
    return [];
  }

  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? TRANSLATION_BATCH_SIZE, 50),
  );
  const translations: Array<{ id: string; text: string }> = [];

  for (const batch of buildTranslationBatches(segments, {
    batchSize,
    maxCharacters: TRANSLATION_BATCH_CHARACTER_LIMIT,
  })) {
    const content = await createOpenRouterChatCompletion({
      messages: buildChineseTranslationMessages(batch),
      maxTokens: 3000,
      temperature: 0.1,
    });

    translations.push(
      ...parseChineseTranslationResponse({
        content,
        segmentIds: batch.map((segment) => segment.id),
      }),
    );
  }

  return translations;
}

export async function polishTranscriptSegmentsInOriginalLanguage(
  segments: Array<{ id: string; text: string }>,
  options: { batchSize?: number } = {},
) {
  if (segments.length === 0) {
    return [];
  }

  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? TRANSLATION_BATCH_SIZE, 50),
  );
  const polishedSegments: Array<{ id: string; text: string }> = [];

  for (const batch of buildTranslationBatches(segments, {
    batchSize,
    maxCharacters: TRANSLATION_BATCH_CHARACTER_LIMIT,
  })) {
    const content = await createOpenRouterChatCompletion({
      messages: buildOriginalTranscriptPolishMessages(batch),
      maxTokens: 3000,
      temperature: 0.1,
    });

    polishedSegments.push(
      ...parseOriginalTranscriptPolishResponse({
        content,
        segmentIds: batch.map((segment) => segment.id),
      }),
    );
  }

  return polishedSegments;
}

function buildTranslationBatches(
  segments: Array<{ id: string; text: string }>,
  options: { batchSize: number; maxCharacters: number },
) {
  const batches: Array<Array<{ id: string; text: string }>> = [];
  let batch: Array<{ id: string; text: string }> = [];
  let batchCharacters = 0;

  for (const segment of segments) {
    const segmentCharacters = segment.text.length;
    const wouldExceedSize =
      batch.length > 0 &&
      batchCharacters + segmentCharacters > options.maxCharacters;
    const wouldExceedCount = batch.length >= options.batchSize;

    if (wouldExceedSize || wouldExceedCount) {
      batches.push(batch);
      batch = [];
      batchCharacters = 0;
    }

    batch.push(segment);
    batchCharacters += segmentCharacters;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

async function createOpenRouterChatCompletion(input: {
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens: number;
  temperature: number;
}) {
  const env = openRouterEnvSchema.parse(process.env);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(env.NEXT_PUBLIC_APP_URL
        ? { "HTTP-Referer": env.NEXT_PUBLIC_APP_URL }
        : {}),
      "X-Title": "Meeting Note",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter chat completion failed with ${response.status} ${response.statusText}`,
    );
  }

  const parsed = openRouterResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter chat completion response missing content");
  }

  return content;
}
