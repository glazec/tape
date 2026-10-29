import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const { execute, retrieveRecallBot, applyRecallMeetingEvent } = vi.hoisted(() => ({
  execute: vi.fn(), retrieveRecallBot: vi.fn(), applyRecallMeetingEvent: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { execute } }));
vi.mock("@/lib/recall-meetings", () => ({ applyRecallMeetingEvent }));
vi.mock("@/lib/vendors/recall", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/vendors/recall")>(), retrieveRecallBot,
}));
import { listRecallMeetingsToReconcile, reconcileRecallMeeting } from "@/lib/recall-meeting-reconciliation";
const input = { id: "meeting", recall_bot_id: "bot" };
beforeEach(() => vi.resetAllMocks());
describe("Recall reconciliation", () => {
  it("recovers a completed recording even when every status webhook was lost", async () => {
    retrieveRecallBot.mockResolvedValue({ id: "bot", metadata: { resumeRecording: true },
      status_changes: [{ code: "done", created_at: "2026-10-29T03:00:00Z" }],
      recordings: [{ id: "recording", status: { code: "done", updated_at: "2026-10-29T03:00:00Z" } }],
    });
    await reconcileRecallMeeting(input);
    expect(applyRecallMeetingEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "recording.done", botId: "bot", recordingId: "recording",
      metadata: { meetingId: "meeting", resumeRecording: true },
    }));
  });
  it("preserves waiting-room and no-recording terminal states", async () => {
    for (const code of ["in_waiting_room", "done"]) {
      retrieveRecallBot.mockResolvedValue({ id: "bot", metadata: {}, recordings: [],
        status_changes: [{ code, sub_code: "timeout_exceeded_waiting_room", created_at: "2026-10-29T03:00:00Z" }],
      });
      await reconcileRecallMeeting(input);
      expect(applyRecallMeetingEvent).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: `bot.${code}`, recordingId: null }));
    }
  });
  it("propagates provider and dispatch failures so the durable step retries", async () => {
    retrieveRecallBot.mockRejectedValue(new Error("provider unavailable"));
    await expect(reconcileRecallMeeting(input)).rejects.toThrow("provider unavailable");
    expect(applyRecallMeetingEvent).not.toHaveBeenCalled();
  });
  it("selects interrupted queued jobs without retrying running or finished work", async () => {
    execute.mockResolvedValue({ rows: [] });
    await listRecallMeetingsToReconcile();
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("m.status in ('scheduled', 'recording', 'processing', 'failed')");
    expect(query.sql).toContain("j.status <> 'queued' or j.provider_job_id is not null");
    expect(query.sql).toContain("order by m.updated_at asc limit 100");
  });
});
