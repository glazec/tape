import { z } from "zod";

import {
  buildChineseTranslationMessages,
  parseChineseTranslationResponse,
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
) {
  if (segments.length === 0) {
    return [];
  }

  const content = await createOpenRouterChatCompletion({
    messages: buildChineseTranslationMessages(segments),
    maxTokens: 2000,
    temperature: 0.1,
  });

  return parseChineseTranslationResponse({
    content,
    segmentIds: segments.map((segment) => segment.id),
  });
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
