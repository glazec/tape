import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoGenerateMeetingFollowup: vi.fn(),
}));
vi.mock("@/lib/meeting-followup-generation", () => mocks);

import { generateMeetingFollowupOnTranscript } from "@/inngest/meeting-followup";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

const meetingId = "11111111-1111-4111-8111-111111111111";
const run = vi.fn(async (_name: string, fn: () => unknown) => fn());
const sleep = vi.fn();

function execute(data: Record<string, unknown>) {
  return (
    generateMeetingFollowupOnTranscript as unknown as {
      fn: (input: unknown) => Promise<unknown>;
    }
  ).fn({ event: { data }, step: { run, sleep } });
}

afterEach(() => vi.clearAllMocks());

describe("automatic meeting followup", () => {
  it("generates once a finished transcript is ready", async () => {
    mocks.autoGenerateMeetingFollowup.mockResolvedValue({ status: "saved" });

    expect(await execute({ meetingId, sendCompletionEmail: true })).toEqual({
      status: "saved",
    });
    expect(mocks.autoGenerateMeetingFollowup).toHaveBeenCalledWith(meetingId);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("ignores translation requests that reuse the enrichment event", async () => {
    expect(await execute({ meetingId })).toEqual({
      status: "skipped",
      reason: "not_transcript_completion",
    });
    expect(mocks.autoGenerateMeetingFollowup).not.toHaveBeenCalled();
  });

  it("waits for the meeting to become ready before generating", async () => {
    mocks.autoGenerateMeetingFollowup
      .mockResolvedValueOnce({ status: "not_ready" })
      .mockResolvedValueOnce({ status: "saved" });

    expect(await execute({ meetingId, sendCompletionEmail: true })).toEqual({
      status: "saved",
    });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries when enrichment changes the meeting during generation", async () => {
    mocks.autoGenerateMeetingFollowup
      .mockResolvedValueOnce({ status: "meeting_changed" })
      .mockResolvedValueOnce({ status: "transcript_changed" })
      .mockResolvedValueOnce({ status: "saved" });

    expect(await execute({ meetingId, sendCompletionEmail: true })).toEqual({
      status: "saved",
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, expect.any(String), "20s");
    expect(sleep).toHaveBeenNthCalledWith(2, expect.any(String), "40s");
  });

  it("gives up after repeated concurrent changes", async () => {
    mocks.autoGenerateMeetingFollowup.mockResolvedValue({ status: "meeting_changed" });

    expect(await execute({ meetingId, sendCompletionEmail: true })).toEqual({
      status: "meeting_changed",
    });
    expect(mocks.autoGenerateMeetingFollowup).toHaveBeenCalledTimes(5);
  });

  it("stops without failing when the workspace is out of credit", async () => {
    mocks.autoGenerateMeetingFollowup.mockRejectedValue(
      new ProviderCreditExhaustedError(0),
    );

    expect(await execute({ meetingId, sendCompletionEmail: true })).toEqual({
      status: "credit_exhausted",
    });
  });

  it("surfaces provider failures so the job retries", async () => {
    mocks.autoGenerateMeetingFollowup.mockRejectedValue(
      new Error("OpenRouter chat completion failed with 401 Unauthorized"),
    );

    await expect(
      execute({ meetingId, sendCompletionEmail: true }),
    ).rejects.toThrow("401");
  });
});
