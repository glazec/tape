import { z } from "zod";

import {
  DEFAULT_RECALL_BOT_NAME,
  sendRecallChatMessage,
} from "@/lib/vendors/recall";
import { generateOpenRouterChatReply } from "@/lib/vendors/openrouter";

const recallMetadataSchema = z.record(z.string(), z.unknown());

const recallChatWebhookSchema = z.object({
  event: z.literal("participant_events.chat_message"),
  data: z.object({
    data: z.object({
      participant: z.object({
        id: z.union([z.number(), z.string()]),
        name: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
      }),
      timestamp: z.object({
        absolute: z.string().min(1),
      }),
      data: z.object({
        text: z.string(),
        to: z.string().optional().nullable(),
      }),
    }),
    bot: z.object({
      id: z.string().min(1),
      metadata: recallMetadataSchema.optional().nullable(),
    }),
  }),
});

export function normalizeRecallChatWebhook(payload: unknown) {
  const parsed = recallChatWebhookSchema.parse(payload);

  return {
    eventType: parsed.event,
    botId: parsed.data.bot.id,
    metadata: parsed.data.bot.metadata ?? {},
    participant: {
      id: parsed.data.data.participant.id,
      name: parsed.data.data.participant.name ?? null,
      email: parsed.data.data.participant.email ?? null,
    },
    text: parsed.data.data.data.text,
    to: parsed.data.data.data.to ?? null,
    timestamp: parsed.data.data.timestamp.absolute,
  };
}

export type RecallChatMessage = ReturnType<typeof normalizeRecallChatWebhook>;

export function shouldAnswerRecallChatMessage(event: RecallChatMessage):
  | { shouldAnswer: true; question: string }
  | {
      shouldAnswer: false;
      reason: "empty_message" | "authored_by_bot" | "not_addressed_to_bot";
    } {
  const text = event.text.trim();

  if (!text) {
    return { shouldAnswer: false, reason: "empty_message" };
  }

  const botName = getEventBotName(event);

  if (event.participant.name === botName) {
    return { shouldAnswer: false, reason: "authored_by_bot" };
  }

  if (event.to === "only_bot") {
    return { shouldAnswer: true, question: text };
  }

  if (includesBotMention(text, botName)) {
    return { shouldAnswer: true, question: stripBotMention(text, botName) };
  }

  return { shouldAnswer: false, reason: "not_addressed_to_bot" };
}

export async function answerRecallChatMessage(event: RecallChatMessage) {
  const decision = shouldAnswerRecallChatMessage(event);

  if (!decision.shouldAnswer) {
    return { action: "skipped" as const, reason: decision.reason };
  }

  const reply = await generateOpenRouterChatReply({
    question: decision.question,
    participantName: event.participant.name,
  });

  await sendRecallChatMessage({
    botId: event.botId,
    message: reply,
    to:
      event.to === "only_bot"
        ? String(event.participant.id)
        : "everyone",
  });

  return { action: "replied" as const, reply };
}

function getEventBotName(event: RecallChatMessage) {
  const metadataName = event.metadata.botName;

  return typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : DEFAULT_RECALL_BOT_NAME;
}

function includesBotMention(text: string, botName: string) {
  return text.toLowerCase().includes(botName.toLowerCase());
}

function stripBotMention(text: string, botName: string) {
  const mentionPattern = new RegExp(`@?${escapeRegex(botName)}`, "gi");
  const stripped = text.replace(mentionPattern, "").trim();

  return stripped || text.trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
