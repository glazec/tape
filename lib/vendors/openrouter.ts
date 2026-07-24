import { z } from "zod";

import {
  buildTranslationJsonSchema,
  buildTranslationMessages,
  buildOriginalTranscriptPolishMessages,
  parseTranslationResponse,
  parseOriginalTranscriptPolishResponse,
  TranslationResponseError,
} from "@/lib/meeting-translation";
import type { TranslationLanguage } from "@/lib/meeting-translation-language";
import type { ProviderUsageCategory } from "@/lib/provider-usage";
import { searchWebWithExa } from "@/lib/vendors/exa";

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

const openRouterToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

const openRouterResponseSchema = z.object({
  id: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  choices: z.array(
    z.object({
      finish_reason: z.string().optional().nullable(),
      message: z
        .object({
          content: z.string().optional().nullable(),
          tool_calls: z.array(openRouterToolCallSchema).optional(),
        })
        .optional()
        .nullable(),
    }),
  ),
  usage: z
    .object({
      completion_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
      prompt_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional()
    .nullable(),
});
export const TRANSLATION_BATCH_SIZE = 10;
const TRANSLATION_BATCH_CHARACTER_LIMIT = 1800;
const OPENROUTER_COMPLETION_ATTEMPTS = 3;
const MEETING_CHAT_MAX_TOKENS = 900;

const searchWebToolArgumentsSchema = z.object({
  query: z.string().trim().min(1),
});

const searchWebTool = {
  type: "function" as const,
  function: {
    name: "search_web",
    description:
      "Search the public web with Exa for current, external, or factual information. Do not use it for private meeting data or questions that can be answered without web research.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A focused web search question.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

type OpenRouterToolCall = z.infer<typeof openRouterToolCallSchema>;
type MeetingChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: OpenRouterToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
    };

type TranscriptSegment = { id: string; text: string };

export async function generateOpenRouterChatReply(input: {
  botName?: string | null;
  meetingId?: string | null;
  question: string;
  participantName?: string | null;
  recentMessages?: Array<{
    participantName?: string | null;
    text: string;
  }>;
}) {
  const botName = input.botName?.trim() || "the meeting assistant";
  const participantName = input.participantName?.trim() || "A participant";
  const messages: MeetingChatMessage[] = [
    {
      role: "system",
      content: `You are ${botName}, a concise meeting assistant inside a live meeting chat. Answer the user's question directly. Use plain text without Markdown because meeting chat does not render Markdown. If the answer requires live transcript or private app data you do not have, say that briefly. Use web search for current or external facts when it is available, and include at most two short source URLs when search is used. Keep the complete answer under 700 characters.`,
    },
    ...(input.recentMessages ?? []).slice(-5).map((message) => ({
      role: "user" as const,
      content: `${message.participantName?.trim() || "A participant"} said in the meeting chat:\n${message.text}`,
    })),
    {
      role: "user",
      content: `${participantName} asked in the meeting chat:\n${input.question}`,
    },
  ];
  const searchEnabled = Boolean(process.env.EXA_API_KEY?.trim());
  const firstChoice = await createMeetingChatCompletion({
    messages,
    searchToolChoice: searchEnabled ? "auto" : null,
    usageContext: {
      category: "assistant",
      meetingId: input.meetingId,
    },
  });
  const toolCall = firstChoice.message?.tool_calls?.[0];

  if (!toolCall) {
    return getMeetingChatContent(firstChoice);
  }

  const toolResult = await runMeetingChatTool(toolCall);
  messages.push({
    role: "assistant",
    content: firstChoice.message?.content ?? null,
    tool_calls: [toolCall],
  });
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    name: toolCall.function.name,
    content: JSON.stringify(toolResult),
  });

  const finalChoice = await createMeetingChatCompletion({
    messages,
    searchToolChoice: "none",
    usageContext: {
      category: "assistant",
      meetingId: input.meetingId,
    },
  });

  return getMeetingChatContent(finalChoice);
}

async function runMeetingChatTool(toolCall: OpenRouterToolCall) {
  if (toolCall.function.name !== searchWebTool.function.name) {
    return { error: "Unsupported tool" };
  }

  try {
    const parsedArguments = searchWebToolArgumentsSchema.parse(
      JSON.parse(toolCall.function.arguments),
    );

    return await searchWebWithExa(parsedArguments.query);
  } catch {
    return { error: "Web search is temporarily unavailable" };
  }
}

async function createMeetingChatCompletion(input: {
  messages: MeetingChatMessage[];
  searchToolChoice: "auto" | "none" | null;
  usageContext?: OpenRouterUsageContext;
}) {
  const env = openRouterEnvSchema.parse(process.env);

  for (
    let attempt = 1;
    attempt <= OPENROUTER_COMPLETION_ATTEMPTS;
    attempt += 1
  ) {
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
        temperature: 0.3,
        max_tokens: MEETING_CHAT_MAX_TOKENS * attempt,
        reasoning: { effort: "none" },
        ...(input.searchToolChoice
          ? {
              tools: [searchWebTool],
              tool_choice: input.searchToolChoice,
              parallel_tool_calls: false,
            }
          : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenRouter chat completion failed with ${response.status} ${response.statusText}`,
      );
    }

    const parsed = await parseOpenRouterResponse(
      await response.json(),
      input.usageContext,
    );
    const choice = parsed.choices[0];

    if (!choice) {
      throw new Error("OpenRouter chat completion response missing choice");
    }

    if (choice.finish_reason === "length") {
      continue;
    }

    return choice;
  }

  throw new Error("OpenRouter meeting chat reply stopped at the token limit");
}

function getMeetingChatContent(
  choice: z.infer<typeof openRouterResponseSchema>["choices"][number],
) {
  const content = choice.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter chat completion response missing content");
  }

  return content;
}

export async function translateTranscriptSegments(
  segments: TranscriptSegment[],
  options: {
    batchSize?: number;
    meetingId?: string;
    onTranslated?: (
      translations: Array<{ id: string; text: string }>,
    ) => Promise<void> | void;
    targetLanguage: TranslationLanguage;
  },
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
      ...(await translateBatchWithRecovery(
        batch,
        options.targetLanguage,
        options.onTranslated,
        options.meetingId,
      )),
    );
  }

  return translations;
}

async function translateBatchWithRecovery(
  batch: TranscriptSegment[],
  targetLanguage: TranslationLanguage,
  onTranslated?: (
    translations: Array<{ id: string; text: string }>,
  ) => Promise<void> | void,
  meetingId?: string,
): Promise<Array<{ id: string; text: string }>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OPENROUTER_COMPLETION_ATTEMPTS; attempt += 1) {
    try {
      const content = await createOpenRouterChatCompletion({
        attempts: 1,
        messages: buildTranslationMessages(batch, targetLanguage),
        maxTokens: 3000,
        plugins: [{ id: "response-healing" }],
        provider: { require_parameters: true },
        responseFormat: buildTranslationJsonSchema(batch.length),
        temperature: 0,
        usageContext: {
          category: "translation",
          meetingId,
        },
      });
      const translatedRows = parseTranslationResponse({
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
        targetLanguage,
        onTranslated,
        meetingId,
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
        return translateSplitBatch(
          batch,
          targetLanguage,
          onTranslated,
          meetingId,
        );
      }
    }
  }

  if (batch.length > 1) {
    return translateSplitBatch(batch, targetLanguage, onTranslated, meetingId);
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
  targetLanguage: TranslationLanguage,
  onTranslated?: (
    translations: Array<{ id: string; text: string }>,
  ) => Promise<void> | void,
  meetingId?: string,
) {
  const middle = Math.ceil(batch.length / 2);
  const firstHalf = await translateBatchWithRecovery(
    batch.slice(0, middle),
    targetLanguage,
    onTranslated,
    meetingId,
  );
  const secondHalf = await translateBatchWithRecovery(
    batch.slice(middle),
    targetLanguage,
    onTranslated,
    meetingId,
  );

  return [...firstHalf, ...secondHalf];
}

export function translateTranscriptSegmentsToChinese(
  segments: TranscriptSegment[],
  options: {
    batchSize?: number;
    onTranslated?: (
      translations: Array<{ id: string; text: string }>,
    ) => Promise<void> | void;
  } = {},
) {
  return translateTranscriptSegments(segments, {
    ...options,
    targetLanguage: "zh-CN",
  });
}

export async function polishTranscriptSegmentsInOriginalLanguage(
  segments: Array<{ id: string; text: string }>,
  options: { batchSize?: number; meetingId?: string } = {},
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
      usageContext: {
        category: "transcript_polish",
        meetingId: options.meetingId,
      },
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
  usageContext?: OpenRouterUsageContext;
}) {
  const env = openRouterEnvSchema.parse(process.env);
  const attempts = input.attempts ?? OPENROUTER_COMPLETION_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
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
        },
      );

      if (!response.ok) {
        throw new Error(
          `OpenRouter chat completion failed with ${response.status} ${response.statusText}`,
        );
      }

      const parsed = await parseOpenRouterResponse(
        await response.json(),
        input.usageContext,
      );
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

type OpenRouterUsageContext = {
  category: Extract<
    ProviderUsageCategory,
    "assistant" | "transcript_polish" | "translation"
  >;
  meetingId?: string | null;
};

async function parseOpenRouterResponse(
  value: unknown,
  usageContext?: OpenRouterUsageContext,
) {
  const parsed = openRouterResponseSchema.parse(value);

  if (
    usageContext?.meetingId &&
    parsed.id &&
    parsed.usage?.cost &&
    parsed.usage.cost > 0
  ) {
    const { recordOpenRouterCompletionUsage } =
      await import("@/lib/provider-usage");

    try {
      await recordOpenRouterCompletionUsage({
        category: usageContext.category,
        generationId: parsed.id,
        meetingId: usageContext.meetingId,
        model: parsed.model,
        usage: {
          completionTokens: parsed.usage.completion_tokens,
          costUsd: parsed.usage.cost,
          promptTokens: parsed.usage.prompt_tokens,
          totalTokens: parsed.usage.total_tokens,
        },
      });
    } catch (error) {
      console.error("Could not record OpenRouter provider usage", {
        error,
        generationId: parsed.id,
      });
    }
  }

  return parsed;
}
