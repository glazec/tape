import { describe, expect, it } from "vitest";
import { isMeetingRecordingResumeEligible } from "@/lib/meeting-bot-recovery-policy";
const endedAt = "2026-10-27T15:00:00.000Z";
const input = {
  canManage: true,
  platform: "zoom",
  status: "processing",
  lastRecordingEndedAt: endedAt,
  scheduledStartedAt: null,
  scheduledEndedAt: null,
};
describe("recording continuation window", () => {
  it("allows continuation before transcription completes without calendar dates", () => {
    expect(
      isMeetingRecordingResumeEligible({
        ...input,
        now: new Date("2026-10-27T15:59:59.999Z"),
      }),
    ).toBe(true);
  });
  it("closes exactly one hour after the actual recording end", () => {
    expect(
      isMeetingRecordingResumeEligible({
        ...input,
        now: new Date("2026-10-27T16:00:00Z"),
      }),
    ).toBe(false);
  });
  it("never extends the window using a future calendar end", () => {
    expect(
      isMeetingRecordingResumeEligible({
        ...input,
        scheduledEndedAt: "2026-10-27T18:00:00Z",
        now: new Date("2026-10-27T16:00:01Z"),
      }),
    ).toBe(false);
  });
  it.each(["recording", "scheduled", "cancelled"])(
    "rejects %s meetings",
    (status) => {
      expect(
        isMeetingRecordingResumeEligible({
          ...input,
          status,
          now: new Date(endedAt),
        }),
      ).toBe(false);
    },
  );
  it("rejects missing, invalid, or future recording ends and non managers", () => {
    for (const lastRecordingEndedAt of [
      null,
      "invalid",
      "2026-10-27T16:00:00Z",
    ])
      expect(
        isMeetingRecordingResumeEligible({
          ...input,
          lastRecordingEndedAt,
          now: new Date(endedAt),
        }),
      ).toBe(false);
    expect(
      isMeetingRecordingResumeEligible({
        ...input,
        canManage: false,
        now: new Date(endedAt),
      }),
    ).toBe(false);
  });
});
