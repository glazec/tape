import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateOpenRouterChatReply, sendRecallChatMessage } = vi.hoisted(
  () => ({
    generateOpenRouterChatReply: vi.fn(),
    sendRecallChatMessage: vi.fn(),
  }),
);

vi.mock("@/lib/vendors/openrouter", () => ({
  generateOpenRouterChatReply,
}));

vi.mock("@/lib/vendors/recall", () => ({
  sendRecallChatMessage,
}));

import {
  answerRecallChatMessage,
  normalizeRecallChatWebhook,
} from "@/lib/recall-chat";

const directMessagePayload = {
  event: "participant_events.chat_message",
  data: {
    data: {
      participant: {
        id: 16_778_240,
        name: "Alice",
        email: "alice@example.com",
      },
      timestamp: {
        absolute: "2026-07-16T21:51:00.000Z",
      },
      data: {
        text: "What is the latest market data?",
        to: "only_bot",
      },
    },
    bot: {
      id: "bot_123",
      metadata: {},
    },
  },
};

describe("answerRecallChatMessage", () => {
  beforeEach(() => {
    generateOpenRouterChatReply.mockReset();
    sendRecallChatMessage.mockReset();
    generateOpenRouterChatReply.mockResolvedValue("Here is the answer.");
    sendRecallChatMessage.mockResolvedValue({});
  });

  it("sends a direct answer only to the participant who messaged the bot", async () => {
    const event = normalizeRecallChatWebhook(directMessagePayload);

    await expect(answerRecallChatMessage(event)).resolves.toMatchObject({
      action: "replied",
    });
    expect(generateOpenRouterChatReply).toHaveBeenCalledWith({
      botName: "Tape Notetaker",
      participantName: "Alice",
      question: "What is the latest market data?",
    });
    expect(sendRecallChatMessage).toHaveBeenCalledWith({
      botId: "bot_123",
      message: "Here is the answer.",
      to: "16778240",
    });
  });
});
