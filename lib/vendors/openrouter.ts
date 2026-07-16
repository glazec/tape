import { z } from "zod";

import {
  buildChineseTranslationJsonSchema,
  buildChineseTranslationMessages,
  buildOriginalTranscriptPolishMessages,
  parseChineseTranslationResponse,
  parseOriginalTranscriptPolishResponse,
  TranslationResponseError,
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
      finish_reason: z.string().optional().nullable(),
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
const OPENROUTER_COMPLETION_ATTEMPTS = 3;

type TranscriptSegment = { id: string; text: string };

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
  segments: TranscriptSegment[],
  options: {
    batchSize?: number;
    onTranslated?: (
      translations: Array<{ id: string; text: string }>,
    ) => Promise<void> | void;
  } = {},
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
    translations.push(
      ...(await translateBatchWithRecovery(batch, options.onTranslated)),
    );
  }

  return translations;
}

async function translateBatchWithRecovery(
  batch: TranscriptSegment[],
  onTranslated?: (
    translations: Array<{ id: string; text: string }>,
  ) => Promise<void> | void,
): Promise<Array<{ id: string; text: string }>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OPENROUTER_COMPLETION_ATTEMPTS; attempt += 1) {
    try {
      const content = await createOpenRouterChatCompletion({
        attempts: 1,
        messages: buildChineseTranslationMessages(batch),
        maxTokens: 3000,
        plugins: [{ id: "response-healing" }],
        provider: { require_parameters: true },
        responseFormat: buildChineseTranslationJsonSchema(batch.length),
        temperature: 0,
      });
      const translatedRows = parseChineseTranslationResponse({
        content,
        segments: batch,
      });
      const translatedById = new Map(
        translatedRows.map((row) => [row.id, row.text]),
      );
      const missingSegments = batch.filter(
        (segment) => !translatedById.has(segment.id),
      );

      if (translatedRows.length > 0) {
        await onTranslated?.(translatedRows);
      }

      if (missingSegments.length === 0) {
        return translatedRows;
      }

      if (missingSegments.length === batch.length) {
        lastError = new Error("OpenRouter returned no usable translations");
        continue;
      }

      const recoveredRows = await translateBatchWithRecovery(
        missingSegments,
        onTranslated,
      );
      const recoveredById = new Map(
        recoveredRows.map((row) => [row.id, row.text]),
      );

      return batch.map((segment) => ({
        id: segment.id,
        text: translatedById.get(segment.id) ?? recoveredById.get(segment.id)!,
      }));
    } catch (error) {
      lastError = error;

      if (error instanceof TranslationResponseError && batch.length > 1) {
        return translateSplitBatch(batch, onTranslated);
      }
    }
  }

  if (batch.length > 1) {
    return translateSplitBatch(batch, onTranslated);
  }

  const message =
    lastError instanceof Error && lastError.message.trim()
      ? lastError.message
      : "unknown OpenRouter error";
  throw new Error(
    `OpenRouter translation failed for segment ${batch[0]?.id ?? "unknown"} after ${OPENROUTER_COMPLETION_ATTEMPTS} attempts: ${message}`,
    { cause: lastError },
  );
}

async function translateSplitBatch(
  batch: TranscriptSegment[],
  onTranslated?: (
    translations: Array<{ id: string; text: string }>,
  ) => Promise<void> | void,
) {
  const middle = Math.ceil(batch.length / 2);
  const firstHalf = await translateBatchWithRecovery(
    batch.slice(0, middle),
    onTranslated,
  );
  const secondHalf = await translateBatchWithRecovery(
    batch.slice(middle),
    onTranslated,
  );

  return [...firstHalf, ...secondHalf];
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

    const polishedTextById = new Map(
      parseOriginalTranscriptPolishResponse({
        content,
        segmentIds: batch.map((segment) => segment.id),
      }).map((segment) => [segment.id, segment.text]),
    );

    polishedSegments.push(
      ...batch.map((segment) => ({
        id: segment.id,
        text: polishedTextById.get(segment.id) ?? segment.text,
      })),
    );
  }

  return polishedSegments;
}

function buildTranslationBatches(
  segments: TranscriptSegment[],
  options: { batchSize: number; maxCharacters: number },
) {
  const batches: TranscriptSegment[][] = [];
  let batch: TranscriptSegment[] = [];
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
  attempts?: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens: number;
  plugins?: Array<{ id: string }>;
  provider?: { require_parameters: boolean };
  responseFormat?: Record<string, unknown>;
  temperature: number;
}) {
  const env = openRouterEnvSchema.parse(process.env);
  const attempts = input.attempts ?? OPENROUTER_COMPLETION_ATTEMPTS;
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt += 1
  ) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
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
          reasoning: { effort: "none" },
          response_format: input.responseFormat ?? { type: "json_object" },
          ...(input.plugins ? { plugins: input.plugins } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter chat completion failed with ${response.status} ${response.statusText}`,
        );
      }

      const parsed = openRouterResponseSchema.parse(await response.json());
      const choice = parsed.choices[0];
      const content = choice?.message?.content?.trim();

      if (choice?.finish_reason === "length") {
        throw new Error("OpenRouter completion stopped at the token limit");
      }

      if (content) {
        return content;
      }

      lastError = new Error("OpenRouter completion response missing content");
    } catch (error) {
      lastError = error;
    }
  }

  const detail =
    lastError instanceof Error && lastError.message.trim()
      ? `: ${lastError.message}`
      : "";
  throw new Error(
    `OpenRouter model ${env.OPENROUTER_MODEL} failed after ${attempts} attempts${detail}`,
    { cause: lastError },
  );
}
