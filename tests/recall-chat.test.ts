import { describe, expect, it } from "vitest";

import {
  normalizeRecallChatWebhook,
  shouldAnswerRecallChatMessage,
} from "@/lib/recall-chat";

const chatPayload = {
  event: "participant_events.chat_message",
  data: {
    data: {
      participant: {
        id: 7,
        name: "Alice",
        is_host: false,
        platform: "desktop",
        extra_data: {},
        email: "alice@example.com",
      },
      timestamp: {
        absolute: "2026-06-27T16:00:00.000Z",
        relative: 12.5,
      },
      data: {
        text: "@Tape Notetaker what did we decide?",
        to: "everyone",
      },
    },
    bot: {
      id: "bot_123",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    },
  },
};

describe("Recall chat messages", () => {
  it("normalizes real time Recall chat message webhooks", () => {
    expect(normalizeRecallChatWebhook(chatPayload)).toEqual({
      eventType: "participant_events.chat_message",
      botId: "bot_123",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
      participant: {
        id: 7,
        name: "Alice",
        email: "alice@example.com",
      },
      text: "@Tape Notetaker what did we decide?",
      to: "everyone",
      timestamp: "2026-06-27T16:00:00.000Z",
    });
  });

  it("answers direct messages and global mentions only", () => {
    const globalMention = normalizeRecallChatWebhook(chatPayload);
    const directMessage = normalizeRecallChatWebhook({
      ...chatPayload,
      data: {
        ...chatPayload.data,
        data: {
          ...chatPayload.data.data,
          data: {
            text: "what did we decide?",
            to: "only_bot",
          },
        },
      },
    });
    const unrelatedGlobal = normalizeRecallChatWebhook({
      ...chatPayload,
      data: {
        ...chatPayload.data,
        data: {
          ...chatPayload.data.data,
          data: {
            text: "what did we decide?",
            to: "everyone",
          },
        },
      },
    });

    expect(shouldAnswerRecallChatMessage(globalMention).shouldAnswer).toBe(true);
    expect(shouldAnswerRecallChatMessage(directMessage).shouldAnswer).toBe(true);
    expect(shouldAnswerRecallChatMessage(unrelatedGlobal)).toEqual({
      shouldAnswer: false,
      reason: "not_addressed_to_bot",
    });
  });

  it("answers global mentions of a custom bot name from metadata", () => {
    const customMention = normalizeRecallChatWebhook({
      ...chatPayload,
      data: {
        ...chatPayload.data,
        data: {
          ...chatPayload.data.data,
          data: {
            text: "@Deal Scribe what did we decide?",
            to: "everyone",
          },
        },
        bot: {
          id: "bot_123",
          metadata: {
            botName: "Deal Scribe",
          },
        },
      },
    });

    expect(shouldAnswerRecallChatMessage(customMention)).toEqual({
      shouldAnswer: true,
      question: "what did we decide?",
    });
  });
});
