import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertMeetingHasProviderCredit,
  generateOpenRouterChatReply,
  listRecentRecallChatWebhookPayloads,
  sendRecallChatMessage,
} = vi.hoisted(
  () => ({
    assertMeetingHasProviderCredit: vi.fn(),
    generateOpenRouterChatReply: vi.fn(),
    listRecentRecallChatWebhookPayloads: vi.fn(),
    sendRecallChatMessage: vi.fn(),
  }),
);

vi.mock("@/lib/provider-credit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-credit")>()),
  assertMeetingHasProviderCredit,
}));

vi.mock("@/lib/vendors/openrouter", () => ({
  generateOpenRouterChatReply,
}));

vi.mock("@/lib/vendors/recall", () => ({
  sendRecallChatMessage,
}));

vi.mock("@/lib/vendor-webhook-events", () => ({
  listRecentRecallChatWebhookPayloads,
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
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    },
  },
};

describe("answerRecallChatMessage", () => {
  beforeEach(() => {
    assertMeetingHasProviderCredit.mockReset();
    generateOpenRouterChatReply.mockReset();
    listRecentRecallChatWebhookPayloads.mockReset();
    sendRecallChatMessage.mockReset();
    generateOpenRouterChatReply.mockResolvedValue("Here is the answer.");
    listRecentRecallChatWebhookPayloads.mockResolvedValue([]);
    sendRecallChatMessage.mockResolvedValue({});
    assertMeetingHasProviderCredit.mockResolvedValue(undefined);
  });

  it("sends a direct answer only to the participant who messaged the bot", async () => {
    const event = normalizeRecallChatWebhook(directMessagePayload);

    await expect(
      answerRecallChatMessage(event, { idempotencyKey: "msg_current" }),
    ).resolves.toMatchObject({ action: "replied" });
    expect(listRecentRecallChatWebhookPayloads).toHaveBeenCalledWith({
      botId: "bot_123",
      directMessageParticipantId: "16778240",
      excludeIdempotencyKey: "msg_current",
      limit: 5,
    });
    expect(generateOpenRouterChatReply).toHaveBeenCalledWith({
      botName: "Tape Notetaker",
      meetingId: "11111111-1111-4111-8111-111111111111",
      participantName: "Alice",
      question: "What is the latest market data?",
      recentMessages: [],
    });
    expect(sendRecallChatMessage).toHaveBeenCalledWith({
      botId: "bot_123",
      message: "Here is the answer.",
      to: "16778240",
    });
  });

  it("does not call OpenRouter after the workspace credit is used", async () => {
    const { ProviderCreditExhaustedError } = await import(
      "@/lib/provider-credit"
    );
    assertMeetingHasProviderCredit.mockRejectedValue(
      new ProviderCreditExhaustedError(),
    );
    const event = normalizeRecallChatWebhook(directMessagePayload);

    await expect(
      answerRecallChatMessage(event, { idempotencyKey: "msg_current" }),
    ).resolves.toEqual({
      action: "skipped",
      reason: "credit_exhausted",
    });
    expect(generateOpenRouterChatReply).not.toHaveBeenCalled();
    expect(sendRecallChatMessage).toHaveBeenCalledWith({
      botId: "bot_123",
      message:
        "Tape’s included credit has been used. Existing meetings remain available in the workspace.",
      to: "16778240",
    });
  });

  it.each([
    {
      label: "Google Meet direct chat",
      payload: directMessagePayload,
      recipient: "16778240",
    },
    {
      label: "Zoom room chat",
      payload: {
        ...directMessagePayload,
        data: {
          ...directMessagePayload.data,
          data: {
            ...directMessagePayload.data.data,
            data: {
              text: "@Tape Notetaker what is the latest market data?",
              to: "everyone",
            },
          },
        },
      },
      recipient: "everyone",
    },
  ])(
    "sends a visible retry message when answering fails in $label",
    async ({ payload, recipient }) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      generateOpenRouterChatReply.mockRejectedValue(
        new Error("OpenRouter unavailable"),
      );
      const event = normalizeRecallChatWebhook(payload);

      try {
        await expect(
          answerRecallChatMessage(event, {
            idempotencyKey: "msg_current",
          }),
        ).resolves.toEqual({
          action: "failed",
          reason: "answer_unavailable",
          reply: "I couldn’t answer that just now. Please try again.",
        });
        expect(sendRecallChatMessage).toHaveBeenCalledWith({
          botId: "bot_123",
          message: "I couldn’t answer that just now. Please try again.",
          to: recipient,
        });
        expect(consoleError).toHaveBeenCalledWith(
          "Recall chat answer generation failed",
          expect.objectContaining({
            botId: "bot_123",
            meetingId: "11111111-1111-4111-8111-111111111111",
            participantId: "16778240",
          }),
        );
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it("feeds the previous five chats to OpenRouter in chronological order", async () => {
    listRecentRecallChatWebhookPayloads.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        ...directMessagePayload,
        data: {
          ...directMessagePayload.data,
          data: {
            ...directMessagePayload.data.data,
            participant: {
              ...directMessagePayload.data.data.participant,
              name: `Participant ${5 - index}`,
            },
            timestamp: {
              absolute: `2026-07-16T21:5${5 - index}:00.000Z`,
            },
            data: {
              text: `Earlier message ${5 - index}`,
              to: "everyone",
            },
          },
        },
      })),
    );

    const event = normalizeRecallChatWebhook(directMessagePayload);
    await answerRecallChatMessage(event, { idempotencyKey: "msg_current" });

    expect(generateOpenRouterChatReply).toHaveBeenCalledWith(
      expect.objectContaining({
        recentMessages: [1, 2, 3, 4, 5].map((number) => ({
          participantName: `Participant ${number}`,
          text: `Earlier message ${number}`,
        })),
      }),
    );
  });

  it("keeps private chat history out of public answers", async () => {
    const event = normalizeRecallChatWebhook({
      ...directMessagePayload,
      data: {
        ...directMessagePayload.data,
        data: {
          ...directMessagePayload.data.data,
          data: {
            text: "@Tape Notetaker summarize the discussion",
            to: "everyone",
          },
        },
      },
    });

    await answerRecallChatMessage(event, { idempotencyKey: "msg_public" });

    expect(listRecentRecallChatWebhookPayloads).toHaveBeenCalledWith({
      botId: "bot_123",
      directMessageParticipantId: null,
      excludeIdempotencyKey: "msg_public",
      limit: 5,
    });
  });
});
