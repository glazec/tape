import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareMeetingWithRecognizedParticipants: vi.fn(),
}));
vi.mock("@/lib/meeting-participant-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meeting-participant-access")>()),
  shareMeetingWithRecognizedParticipants:
    mocks.shareMeetingWithRecognizedParticipants,
}));
vi.mock("@/db/client", () => ({ db: {} }));

import { shareMeetingWithParticipantsOnTranscript } from "@/inngest/meeting-participant-sharing";
import { resolveRecognizedParticipantEmails } from "@/lib/meeting-participant-access";

const meetingId = "11111111-1111-4111-8111-111111111111";
const run = vi.fn(async (_name: string, fn: () => unknown) => fn());

function execute(data: Record<string, unknown>) {
  return (
    shareMeetingWithParticipantsOnTranscript as unknown as {
      fn: (input: unknown) => Promise<unknown>;
    }
  ).fn({ event: { data }, step: { run } });
}

afterEach(() => vi.clearAllMocks());

describe("resolveRecognizedParticipantEmails", () => {
  const members = [
    { email: "Ada@iosg.vc", name: "Ada Lovelace" },
    { email: "sam.lee@iosg.vc", name: "Sam" },
    { email: "sam.kim@iosg.vc", name: "Sam" },
  ];

  it("uses the email the meeting platform reports", () => {
    expect(
      resolveRecognizedParticipantEmails({
        aliases: [],
        members: [],
        people: [{ email: "Grace@IOSG.vc", name: "Grace" }],
      }),
    ).toEqual(["grace@iosg.vc"]);
  });

  it("matches a speaker name to exactly one workspace member", () => {
    expect(
      resolveRecognizedParticipantEmails({
        aliases: [],
        members,
        people: [
          { email: null, name: "ada lovelace" },
          { email: null, name: "Ada Lovelace" },
        ],
      }),
    ).toEqual(["ada@iosg.vc"]);
  });

  it("skips names shared by several people and generic speaker labels", () => {
    expect(
      resolveRecognizedParticipantEmails({
        aliases: [],
        members,
        people: [
          { email: null, name: "Sam" },
          { email: null, name: "Speaker 2" },
          { email: null, name: "Visitor" },
        ],
      }),
    ).toEqual([]);
  });

  it("recognizes speakers the team named before", () => {
    expect(
      resolveRecognizedParticipantEmails({
        aliases: [{ alias: "lin@iosg.vc", canonicalName: "Lin Chen" }],
        members: [],
        people: [{ email: null, name: "Lin Chen" }],
      }),
    ).toEqual(["lin@iosg.vc"]);
  });
});

describe("participant sharing job", () => {
  it("shares once a transcript finishes", async () => {
    mocks.shareMeetingWithRecognizedParticipants.mockResolvedValue({
      sharedCount: 2,
      status: "shared",
    });

    expect(await execute({ meetingId, sendCompletionEmail: true })).toEqual({
      sharedCount: 2,
      status: "shared",
    });
    expect(mocks.shareMeetingWithRecognizedParticipants).toHaveBeenCalledWith(
      meetingId,
    );
  });

  it("ignores translation requests that reuse the enrichment event", async () => {
    expect(await execute({ meetingId })).toEqual({
      reason: "not_transcript_completion",
      status: "skipped",
    });
    expect(mocks.shareMeetingWithRecognizedParticipants).not.toHaveBeenCalled();
  });
});
