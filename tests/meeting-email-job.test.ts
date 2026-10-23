import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadMeetingEmailSnapshot: vi.fn(),
  listPendingMeetingEmails: vi.fn(),
  markMeetingEmailsQueued: vi.fn(),
  prepareMeetingEmail: vi.fn(),
  isMeetingEmailCurrent: vi.fn(),
  markMeetingEmailSent: vi.fn(),
  generateMeetingNotes: vi.fn(),
  sendResendEmail: vi.fn(),
  assertMeetingHasProviderCredit: vi.fn(),
}));
vi.mock("@/lib/meeting-email-records", () => mocks);
vi.mock("@/lib/vendors/resend", () => mocks);
vi.mock("@/lib/vendors/openrouter", () => mocks);
vi.mock("@/lib/provider-credit", () => mocks);

import { reconcileMeetingEmails, sendMeetingEmail } from "@/inngest/meeting-email";

const meetingId = "11111111-1111-4111-8111-111111111111";
const transcriptJobId = "22222222-2222-4222-8222-222222222222";
const payload = { from: "Tape <tape@inevitable.tech>", to: ["owner@example.com"], subject: "Tape: Meeting", text: "Ready", attachments: [] };
const ready = () => ({
  action: "ready", meetingId, anchorId: transcriptJobId, jobIds: [transcriptJobId],
  title: "Meeting", recipientEmail: "owner@example.com",
  segments: [{ startMs: 0, speaker: "Jocy", text: "We ship on Monday." }],
  delivery: null,
});
const run = vi.fn(async (_name, fn) => fn());
const sleep = vi.fn();
function execute() {
  return (sendMeetingEmail as unknown as { fn: (input: unknown) => Promise<unknown> }).fn({
    event: { data: { meetingId, transcriptJobId, sendCompletionEmail: true }, ts: Date.now() },
    step: { run, sleep },
  });
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  mocks.loadMeetingEmailSnapshot.mockResolvedValue(ready());
  mocks.generateMeetingNotes.mockResolvedValue("Ship Monday.");
  mocks.prepareMeetingEmail.mockImplementation(async (snapshot, email) => ({ payload: email, jobIds: snapshot.jobIds, preparedAt: new Date().toISOString() }));
  mocks.isMeetingEmailCurrent.mockResolvedValue(true);
  mocks.sendResendEmail.mockResolvedValue("provider-id");
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("automatic meeting email", () => {
  it("recovers persisted completion when the original event dispatch was lost", async () => {
    mocks.listPendingMeetingEmails.mockResolvedValue([{ meetingId, transcriptJobId }]);
    const sendEvent = vi.fn();
    const result = await (reconcileMeetingEmails as unknown as { fn: (input: unknown) => Promise<unknown> }).fn({ step: { run, sendEvent } });
    expect(result).toEqual({ queued: 1 });
    expect(sendEvent).toHaveBeenCalledWith("dispatch-pending-meeting-emails", [{
      name: "meeting/send.completion-email", data: { meetingId, transcriptJobId, sendCompletionEmail: true },
    }]);
    expect(mocks.markMeetingEmailsQueued).toHaveBeenCalledWith([transcriptJobId]);
  });

  it("does not query the outbox when email is disabled", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await (reconcileMeetingEmails as unknown as { fn: (input: unknown) => Promise<unknown> }).fn({ step: { run } });
    expect(result).toEqual({ queued: 0 });
    expect(mocks.listPendingMeetingEmails).not.toHaveBeenCalled();
  });

  it("does nothing when email is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await execute()).toEqual({ action: "skipped", reason: "email_disabled" });
    expect(mocks.loadMeetingEmailSnapshot).not.toHaveBeenCalled();
  });

  it("sends both attachments to the persisted owner and records success", async () => {
    await execute();
    const email = mocks.sendResendEmail.mock.calls[0][0];
    expect(email.to).toEqual(["owner@example.com"]);
    expect(email.from).toBe("Tape <tape@inevitable.tech>");
    expect(email.attachments).toHaveLength(2);
    expect(mocks.sendResendEmail).toHaveBeenCalledWith(email, `meeting-email/${transcriptJobId}`);
    expect(mocks.markMeetingEmailSent).toHaveBeenCalledWith(transcriptJobId, "provider-id");
  });

  it("waits for every audio part before generating notes", async () => {
    mocks.loadMeetingEmailSnapshot.mockResolvedValueOnce({ action: "waiting" });
    await execute();
    expect(sleep).toHaveBeenCalledWith("wait-for-transcripts-0", "1m");
    expect(mocks.generateMeetingNotes).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate and superseded transcript events", async () => {
    mocks.loadMeetingEmailSnapshot.mockResolvedValue({ action: "skipped", reason: "already_sent" });
    await execute();
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
    expect(mocks.generateMeetingNotes).not.toHaveBeenCalled();
  });

  it("rechecks the recording after notes generation", async () => {
    mocks.isMeetingEmailCurrent.mockResolvedValue(false);
    await execute();
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
    expect(mocks.markMeetingEmailSent).not.toHaveBeenCalled();
  });

  it("reuses the frozen payload after a provider or database failure", async () => {
    mocks.loadMeetingEmailSnapshot.mockResolvedValue({ ...ready(), delivery: { payload, jobIds: [transcriptJobId], preparedAt: new Date().toISOString() } });
    await execute();
    expect(mocks.generateMeetingNotes).not.toHaveBeenCalled();
    expect(mocks.sendResendEmail).toHaveBeenCalledWith(payload, `meeting-email/${transcriptJobId}`);
  });

  it("does not mark a rejected email as sent", async () => {
    mocks.sendResendEmail.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(execute()).rejects.toThrow("provider unavailable");
    expect(mocks.markMeetingEmailSent).not.toHaveBeenCalled();
  });

  it("stops ambiguous retries before the provider deduplication window expires", async () => {
    mocks.loadMeetingEmailSnapshot.mockResolvedValue({ ...ready(), delivery: { payload, jobIds: [transcriptJobId], preparedAt: new Date(Date.now() - 24 * 3600000).toISOString() } });
    await expect(execute()).rejects.toThrow("review required");
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
  });

  it("does not send a prepared attachment set after another audio part was added", async () => {
    mocks.loadMeetingEmailSnapshot.mockResolvedValue({ ...ready(), delivery: { payload, jobIds: ["old-job"], preparedAt: new Date().toISOString() } });
    expect(await execute()).toEqual({ action: "skipped", reason: "recording_changed_after_preparation" });
    expect(mocks.sendResendEmail).not.toHaveBeenCalled();
  });

  it("does not send email when the user only requests a translation", async () => {
    const result = await (sendMeetingEmail as unknown as { fn: (input: unknown) => Promise<unknown> }).fn({
      event: { data: { meetingId, transcriptJobId }, ts: Date.now() }, step: { run, sleep },
    });
    expect(result).toEqual({ action: "skipped", reason: "not_transcript_completion" });
    expect(mocks.loadMeetingEmailSnapshot).not.toHaveBeenCalled();
  });
});
