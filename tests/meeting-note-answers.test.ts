import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), where: vi.fn(), orderBy: vi.fn(), generate: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { execute: mocks.execute, select: () => ({ from: () => ({ where: mocks.where }) }) } }));
vi.mock("@/lib/vendors/openrouter", () => ({ generateMeetingNoteAnswer: mocks.generate }));
import { answerMeetingNoteQuestion, getNoteTranscript, noteTranscriptRevision, parseNoteAnswer, NoteTranscriptTooLongError } from "@/lib/meeting-note-answers";

const segments = [{ id: "s1", text: "We invest $2 million in fintech.", startMs: 42_000, speaker: "Sam" }];
const transcript = { segments, transcriptRevision: noteTranscriptRevision(segments), hasTranscript: true };
const supported = { items: [{ text: "Check size: $2 million.", sources: [{ segmentId: "s1", quote: "$2 million" }] }], missing: ["Stage"] };

beforeEach(() => { vi.resetAllMocks(); mocks.where.mockReturnValue({ orderBy: mocks.orderBy }); mocks.orderBy.mockResolvedValue(segments); });

describe("transcript grounded note answers", () => {
  it("loads any available segments in the meeting's active generation", async () => {
    expect(await getNoteTranscript("meeting-one")).toEqual(transcript);
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.params).toContain("meeting-one");
    expect(query.sql).toContain('"transcript_segments"."meeting_id"');
    expect(query.sql).toContain("latest_replace");
    expect(query.sql).not.toContain("current_jobs.status = 'completed'");
  });
  it("resolves cited source speaker display without changing the canonical transcript revision", async () => {
    mocks.orderBy.mockResolvedValue([{ ...segments[0], meetingId: "meeting-one", meetingSpeakerId: "g1", attributionRevision: 0 }]);
    mocks.execute.mockResolvedValue({ rows: [{ id: "s1", speaker: "Alex", sourceSpeaker: "Sam", meetingSpeakerId: "g1", personId: "p1", participantEmail: null, speakerRevision: 0 }] });
    const loaded = await getNoteTranscript("meeting-one");
    expect(loaded.segments[0].speaker).toBe("Alex");
    expect(loaded.transcriptRevision).toBe(transcript.transcriptRevision);
    expect(parseNoteAnswer(JSON.stringify(supported), "Check size?", loaded).sources[0].speaker).toBe("Alex");
  });
  it("hashes exact text, identity, speaker and timestamp changes", () => {
    expect(noteTranscriptRevision([...segments])).toBe(transcript.transcriptRevision);
    for (const change of [{ text: "We invest $5 million." }, { id: "replacement" }, { startMs: 43_000 }, { speaker: "Jane" }]) {
      expect(noteTranscriptRevision([{ ...segments[0], ...change }])).not.toBe(transcript.transcriptRevision);
    }
  });
  it("preserves source revision for preferred names but invalidates attribution changes", () => {
    const renamed = { ...segments[0], speaker: "Alex", sourceSpeaker: "Sam", attributionRevision: 0 };
    expect(noteTranscriptRevision([renamed])).toBe(transcript.transcriptRevision);
    expect(noteTranscriptRevision([{ ...renamed, attributionRevision: 1 }])).not.toBe(transcript.transcriptRevision);
  });
  it("returns only validated exact quotes with server owned source metadata", () => {
    expect(parseNoteAnswer(JSON.stringify(supported), "Check size and stage?", transcript)).toEqual({
      question: "Check size and stage?",
      text: "• Check size: $2 million.\n• Stage: not mentioned in this transcript yet.",
      sources: [{ segmentId: "s1", quote: "$2 million", startMs: 42_000, speaker: "Sam" }],
      transcriptRevision: transcript.transcriptRevision,
    });
  });
  it.each([
    { text: "unsupported", sources: [] },
    { text: "wrong id", sources: [{ segmentId: "unseen", quote: "$2 million" }] },
    { text: "invented quote", sources: [{ segmentId: "s1", quote: "$5 million" }] },
    { text: "empty quote", sources: [{ segmentId: "s1", quote: " " }] },
  ])("rejects missing or fabricated evidence", (item) => {
    expect(() => parseNoteAnswer(JSON.stringify({ items: [item], missing: [] }), "Check size?", transcript)).toThrow();
  });
  it("returns a truthful missing answer without invented evidence", () => {
    expect(parseNoteAnswer(JSON.stringify({ items: [], missing: ["Check size"] }), "Check size?", transcript)).toMatchObject({ text: "Not mentioned in this transcript yet.", sources: [] });
  });
  it("does not silently truncate an oversized transcript", async () => {
    await expect(answerMeetingNoteQuestion("meeting", "Check size?", { ...transcript, segments: [{ ...segments[0], text: "x".repeat(180_001) }] })).rejects.toBeInstanceOf(NoteTranscriptTooLongError);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("uses only the supplied transcript and validates the generated answer", async () => {
    mocks.generate.mockResolvedValue(JSON.stringify(supported));
    await expect(answerMeetingNoteQuestion("meeting", "Check size?", transcript)).resolves.toMatchObject({ sources: [{ segmentId: "s1", quote: "$2 million", startMs: 42_000, speaker: "Sam" }] });
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ meetingId: "meeting", question: "Check size?", segments: [{ id: "s1", text: segments[0].text }] }));
  });
  it("corrects a quote spanning segments without weakening citation validation", async () => {
    const crossed = JSON.stringify({ items: [{ text: "Goal", sources: [{ segmentId: "s1", quote: "We invest $2 million in fintech. We want more people to know us." }] }], missing: [] });
    mocks.generate.mockResolvedValueOnce(crossed).mockResolvedValueOnce(JSON.stringify(supported));
    await expect(answerMeetingNoteQuestion("meeting", "Goal?", transcript)).resolves.toMatchObject({ sources: [{ segmentId: "s1", quote: "$2 million" }] });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[1][0]).toMatchObject({ correction: crossed });
    expect(mocks.generate.mock.calls[1][0].timeoutMs).toBeLessThanOrEqual(30_000);
  });
  it("rejects invalid citations after one correction attempt", async () => {
    mocks.generate.mockResolvedValue(JSON.stringify({ items: [{ text: "Goal", sources: [{ segmentId: "s1", quote: "Invented quote" }] }], missing: [] }));
    await expect(answerMeetingNoteQuestion("meeting", "Goal?", transcript)).rejects.toThrow("unsupported transcript citation");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  it("does not retry provider errors", async () => {
    mocks.generate.mockRejectedValue(new Error("provider unavailable"));
    await expect(answerMeetingNoteQuestion("meeting", "Goal?", transcript)).rejects.toThrow("provider unavailable");
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("does not start a correction after the request deadline", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    mocks.generate.mockImplementation(async () => {
      clock.mockReturnValue(30_000);
      return "invalid JSON";
    });
    try {
      await expect(answerMeetingNoteQuestion("meeting", "Goal?", transcript)).rejects.toThrow();
      expect(mocks.generate).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

});
