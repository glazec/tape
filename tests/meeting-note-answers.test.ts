import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ where: vi.fn(), orderBy: vi.fn(), generate: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: () => ({ from: () => ({ where: mocks.where }) }) } }));
vi.mock("@/lib/vendors/openrouter", () => ({ generateMeetingNoteAnswer: mocks.generate }));
import { answerMeetingNoteQuestion, getNoteTranscript, noteTranscriptRevision, parseNoteAnswer, NoteTranscriptTooLongError } from "@/lib/meeting-note-answers";

const segments = [{ id: "s1", text: "We invest $2 million in fintech.", startMs: 42_000, speaker: "Sam" }];
const transcript = { segments, transcriptRevision: noteTranscriptRevision(segments), hasTranscript: true };
const supported = { items: [{ text: "Check size: $2 million.", sources: [{ segmentId: "s1", quote: "$2 million" }] }], missing: ["Stage"] };

beforeEach(() => { vi.clearAllMocks(); mocks.where.mockReturnValue({ orderBy: mocks.orderBy }); mocks.orderBy.mockResolvedValue(segments); });

describe("transcript grounded note answers", () => {
  it("loads any available segments in the meeting's active generation", async () => {
    expect(await getNoteTranscript("meeting-one")).toEqual(transcript);
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.params).toContain("meeting-one");
    expect(query.sql).toContain('"transcript_segments"."meeting_id"');
    expect(query.sql).toContain("latest_replace");
    expect(query.sql).not.toContain("current_jobs.status = 'completed'");
  });
  it("hashes exact text, identity, speaker and timestamp changes", () => {
    expect(noteTranscriptRevision([...segments])).toBe(transcript.transcriptRevision);
    for (const change of [{ text: "We invest $5 million." }, { id: "replacement" }, { startMs: 43_000 }, { speaker: "Jane" }]) {
      expect(noteTranscriptRevision([{ ...segments[0], ...change }])).not.toBe(transcript.transcriptRevision);
    }
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
    expect(mocks.generate).toHaveBeenCalledWith({ meetingId: "meeting", question: "Check size?", segments: [{ id: "s1", text: segments[0].text }] });
  });
});
