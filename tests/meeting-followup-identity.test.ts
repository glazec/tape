import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FOLLOWUP_PROMPT_VERSION, type FollowupSource } from "@/lib/meeting-followup";
import { getConnectionsSourceHash, getCurrentMeetingFollowup, getFollowupSource, getFollowupSourceHash } from "@/lib/meeting-followup-source";

vi.mock("@/db/client", () => ({ db: {} }));
import { composeMeetingForFollowup } from "@/lib/meeting-composition";

const legacy: FollowupSource = { title: "Call", startedAt: null, segments: [
  { id: "s1", speaker: "Alice", startMs: 0, text: "I will send the memo." },
] };
const renamed: FollowupSource = { ...legacy, attributionRevision: 0, segments: [
  { ...legacy.segments[0], speaker: "Alex", sourceSpeaker: "Alice", meetingSpeakerId: "g1", personId: "p1" },
] };
const result = { todos: [{ person: "Alice", text: "Alice will send the memo.", timing: null,
  evidence: [{ segmentId: "s1", quote: "I will send the memo." }] }], dynamics: [], research: [] };

describe("followup speaker identity source integrity", () => {
  it("preserves the exact deployed zero revision hash after display metadata and preferred names change", () => {
    const expected = createHash("sha256").update(JSON.stringify(["untitled", FOLLOWUP_PROMPT_VERSION,
      { startedAt: legacy.startedAt, segments: legacy.segments }])).digest("hex");
    expect(getFollowupSourceHash(renamed)).toBe(expected);
    expect(getConnectionsSourceHash(renamed)).toBe(getConnectionsSourceHash(legacy));
    expect(getFollowupSource(renamed).segments[0]).toMatchObject({ sourceSpeaker: "Alice", personId: "p1" });
  });
  it("invalidates both source hashes on attribution changes", () => {
    const reassigned = { ...renamed, attributionRevision: 1 };
    expect(getFollowupSourceHash(reassigned)).not.toBe(getFollowupSourceHash(renamed));
    expect(getConnectionsSourceHash(reassigned)).not.toBe(getConnectionsSourceHash(renamed));
  });
  it("composes source revisions from every part", () => {
    const part = { ...renamed, id: "a", status: "ready", transcriptJobStatus: "completed" };
    const secondary = { ...part, id: "b", attributionRevision: 2 };
    const composed = composeMeetingForFollowup({ primary: part, parts: [part, secondary] } as unknown as Parameters<typeof composeMeetingForFollowup>[0]);
    expect(composed.followupSource?.attributionRevisions).toEqual([{ meetingId: "a", revision: 0 }, { meetingId: "b", revision: 2 }]);
    const unchanged = composeMeetingForFollowup({ primary: part, parts: [part, { ...secondary, attributionRevision: 0 }] } as unknown as Parameters<typeof composeMeetingForFollowup>[0]);
    expect(getFollowupSourceHash(composed)).not.toBe(getFollowupSourceHash(unchanged));
  });
  it("binds every composed source revision with stable ordering", () => {
    const first = { ...renamed, attributionRevisions: [{ meetingId: "b", revision: 1 }, { meetingId: "a", revision: 0 }] };
    const reordered = { ...first, attributionRevisions: [...first.attributionRevisions].reverse() };
    const changed = { ...first, attributionRevisions: [{ meetingId: "b", revision: 2 }, { meetingId: "a", revision: 0 }] };
    expect(getFollowupSourceHash(first)).toBe(getFollowupSourceHash(reordered));
    expect(getFollowupSourceHash(first)).not.toBe(getFollowupSourceHash(changed));
    expect(getConnectionsSourceHash(first)).not.toBe(getConnectionsSourceHash(changed));
  });
  it("keeps legacy saved todos after rename and maps the evidenced subject", () => {
    const current = getCurrentMeetingFollowup({ ...renamed, status: "ready", transcriptJobStatus: "completed",
      aiFollowup: { sourceHash: getFollowupSourceHash(legacy), result } });
    expect(current?.todos[0]).toMatchObject({ person: "Alex", text: "Alex will send the memo." });
  });
  it("keeps saved subjects from an intermediate preferred name using the generation snapshot", () => {
    const current = getCurrentMeetingFollowup({ ...renamed, status: "ready", transcriptJobStatus: "completed",
      aiFollowup: { sourceHash: getFollowupSourceHash(legacy), speakerNames: { s1: "Alicia" },
        result: { ...result, todos: [{ ...result.todos[0], person: "Alicia", text: "Alicia will send the memo." }] } } });
    expect(current?.todos[0].person).toBe("Alex");
  });
  it("does not guess which same named identity owns an ambiguously evidenced saved todo", () => {
    const source = { ...renamed, segments: [...renamed.segments, { ...renamed.segments[0], id: "s2", personId: "p2", meetingSpeakerId: "g2", speaker: "Maya" }] };
    const current = getCurrentMeetingFollowup({ ...source, status: "ready", transcriptJobStatus: "completed",
      aiFollowup: { sourceHash: getFollowupSourceHash(source), result: { ...result, todos: [{ ...result.todos[0], evidence: [
        ...result.todos[0].evidence, { segmentId: "s2", quote: "I will send the memo." },
      ] }] } } });
    expect(current?.todos[0].person).toBe("Alice");
  });
});
