import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), access: vi.fn(), transcript: vi.fn(), answer: vi.fn(), rate: vi.fn(), credit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: mocks.workspace }));
vi.mock("@/lib/meeting-notes", () => ({ canReadMeetingNotes: mocks.access }));
vi.mock("@/lib/meeting-note-answers", () => ({ getNoteTranscript: mocks.transcript, answerMeetingNoteQuestion: mocks.answer, NoteTranscriptTooLongError: class NoteTranscriptTooLongError extends Error {} }));
vi.mock("@/lib/request-rate-limit", async (original) => ({ ...await original<typeof import("@/lib/request-rate-limit")>(), assertRequestRateLimit: mocks.rate }));
vi.mock("@/lib/provider-credit", async (original) => ({ ...await original<typeof import("@/lib/provider-credit")>(), assertMeetingHasProviderCredit: mocks.credit }));
import { GET, POST } from "@/app/api/meetings/[meetingId]/notes/answer/route";
import { NoteTranscriptTooLongError } from "@/lib/meeting-note-answers";
import { RequestRateLimitError } from "@/lib/request-rate-limit";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

const meetingId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ meetingId }) };
const transcript = { segments: [{ id: "one", text: "Our focus is fintech." }], transcriptRevision: "a".repeat(64), hasTranscript: true };
const answer = { question: "Focus?", text: "Fintech", sources: [], transcriptRevision: transcript.transcriptRevision };
const request = (body: unknown = { question: "Focus?" }) => new Request("https://example.com/notes/answer", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "auth-user" }); mocks.workspace.mockResolvedValue({ userId: "reader", teamId: "shared-reader-team" });
  mocks.access.mockResolvedValue(true); mocks.transcript.mockResolvedValue(transcript); mocks.answer.mockResolvedValue(answer);
});

describe("private transcript answer API", () => {
  it("requires authentication for metadata and generation", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(401);
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.transcript).not.toHaveBeenCalled();
  });
  it("requires meeting access even for metadata", async () => {
    mocks.access.mockResolvedValue(false);
    expect((await GET(request(), context)).status).toBe(404);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.transcript).not.toHaveBeenCalled();
  });
  it("rejects malformed meeting IDs before querying data", async () => {
    expect((await POST(request(), { params: Promise.resolve({ meetingId: "invalid" }) })).status).toBe(404);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("returns a private revision without leaking transcript text", async () => {
    const response = await GET(request(), context);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ transcriptRevision: transcript.transcriptRevision, hasTranscript: true });
  });
  it.each([{ question: "" }, { question: "Not a question" }, { question: `${"a".repeat(2_001)}?` }, { question: "Focus?", userId: "other" }])("rejects invalid input", async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("waits for actual transcript text without charging or generating", async () => {
    mocks.transcript.mockResolvedValue({ ...transcript, hasTranscript: false, segments: [] });
    const response = await POST(request(), context);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "TRANSCRIPT_PENDING" });
    expect(mocks.credit).not.toHaveBeenCalled(); expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("checks owner meeting credit, limits per user and returns a transient answer", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(answer);
    expect(mocks.credit).toHaveBeenCalledWith(meetingId);
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ subject: "reader", limit: 12 }));
    expect(mocks.transcript).toHaveBeenCalledTimes(2);
  });
  it("rejects an answer if the transcript changes during generation", async () => {
    mocks.transcript.mockResolvedValueOnce(transcript).mockResolvedValueOnce({ ...transcript, transcriptRevision: "b".repeat(64) });
    const response = await POST(request(), context);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "TRANSCRIPT_CHANGED" });
  });
  it("rechecks access after generation", async () => {
    mocks.access.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await POST(request(), context)).status).toBe(404);
  });
  it("returns retry time on rate limit without generating", async () => {
    mocks.rate.mockRejectedValue(new RequestRateLimitError(42));
    const response = await POST(request(), context);
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("42"); expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("honors credit exhaustion", async () => {
    mocks.credit.mockRejectedValue(new ProviderCreditExhaustedError());
    expect((await POST(request(), context)).status).toBe(402); expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("explains oversized transcripts without an impossible retry", async () => {
    mocks.answer.mockRejectedValue(new NoteTranscriptTooLongError());
    const response = await POST(request(), context);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "TRANSCRIPT_TOO_LONG" });
  });
  it("does not expose provider or transcript data in failure responses", async () => {
    mocks.answer.mockRejectedValue(new Error("private provider diagnostic"));
    const response = await POST(request(), context);
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private provider diagnostic");
  });
});
