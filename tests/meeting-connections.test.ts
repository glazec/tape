import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyConnectionEdits, isOrganizationSpeaker, parseMeetingConnections } from "@/lib/meeting-connections";
import { parseMeetingFollowup, type FollowupSource } from "@/lib/meeting-followup";
import { getCurrentMeetingConnections, getConnectionsRevision, getCurrentMeetingFollowup, getConnectionsSourceHash, getFollowupSourceHash } from "@/lib/meeting-followup-source";

const source: FollowupSource = {
  title: "External meeting", startedAt: null,
  segments: [
    { id: "a", speaker: "Alice", startMs: 0, text: "I work closely with the debt team at Citi." },
    { id: "b", speaker: "Bob", startMs: 1000, text: "I met people from BlackRock." },
    { id: "c", speaker: "Alice", startMs: 2000, text: "We have talked to Silicon Data." },
  ],
};
const connection = {
  kind: "team", name: null, company: "Citi", title: null,
  relationship: "works_with", context: "Works closely with the debt team.",
  speakerSegmentId: "a", evidence: [{ segmentId: "a" }],
};
const result = { todos: [], dynamics: [], research: [], connections: [connection] };
const saved = () => ({
  ...source, status: "ready", transcriptJobStatus: "completed",
  aiFollowup: { sourceHash: getFollowupSourceHash(source), connectionsSourceHash: getConnectionsSourceHash(source), result },
});

describe("potential connections", () => {
  it("accepts partial people, teams and project relationships without requiring an introduction", () => {
    const connections = [connection,
      { ...connection, kind: "person", company: "BlackRock", relationship: "met", speakerSegmentId: "b", evidence: [{ segmentId: "b" }] },
      { ...connection, kind: "project", name: "Silicon Data", company: null, relationship: "in_discussion", speakerSegmentId: "c", evidence: [{ segmentId: "c" }] },
    ];
    expect(parseMeetingFollowup(JSON.stringify({ ...result, connections }), source).connections).toEqual(connections);
  });

  it.each([
    { speakerSegmentId: "missing" },
    { speakerSegmentId: "b" },
    { evidence: [{ segmentId: "missing" }] },
  ])("rejects ungrounded connection anchors and evidence: %j", (change) => {
    const output = { ...result, connections: [connection, { ...connection, ...change }] };
    expect(() => parseMeetingFollowup(JSON.stringify(output), source)).toThrow();
    expect(parseMeetingFollowup(JSON.stringify(output), source, { lenient: true }).connections).toEqual([connection]);
  });

  it("retains connections after a speaker rename and only reassigns the corrected segment", () => {
    const meeting = saved();
    const renamed = { ...meeting, segments: meeting.segments.map(s => s.id === "a" ? { ...s, speaker: "Alicia" } : s) };
    expect(getCurrentMeetingConnections(renamed)).toEqual([connection]);
    expect(renamed.segments.find(s => s.id === connection.speakerSegmentId)?.speaker).toBe("Alicia");
    expect(renamed.segments.find(s => s.id === "c")?.speaker).toBe("Alice");
    expect(getCurrentMeetingFollowup(renamed)).toBeNull();
  });

  it("keeps connections when the meeting is renamed", () => {
    expect(getCurrentMeetingConnections({ ...saved(), title: "Other meeting" })).toEqual([connection]);
  });

  it("invalidates connections after edits, added or removed segments, or unfinished processing", () => {
    const meeting = saved();
    for (const change of [
      { segments: [{ ...source.segments[0], text: "We do not know that team." }, ...source.segments.slice(1)] },
      { segments: source.segments.slice(1) },
      { segments: [...source.segments, { ...source.segments[0], id: "new" }] },
      { transcriptJobStatus: "running" },
    ]) expect(getCurrentMeetingConnections({ ...meeting, ...change })).toEqual([]);
  });

  it("keeps saved connections when a new speaker label overlaps existing context", () => {
    const meeting = saved();
    const renamed = { ...meeting, segments: meeting.segments.map(s => ({ ...s, speaker: "Works" })) };
    expect(getCurrentMeetingConnections(renamed)).toEqual([connection]);
  });

  it("does not trust a missing or changed connection fingerprint", () => {
    const meeting = saved();
    expect(getCurrentMeetingConnections({ ...meeting, aiFollowup: { ...meeting.aiFollowup, connectionsSourceHash: "invalid" } })).toEqual([]);
    expect(getCurrentMeetingConnections({ ...meeting, aiFollowup: { sourceHash: meeting.aiFollowup.sourceHash, result } })).toEqual([]);
  });

  it("enforces the local connection limit even though the provider schema omits it", () => {
    expect(() => parseMeetingFollowup(JSON.stringify({ ...result, connections: Array(81).fill(connection) }), source)).toThrow();
  });

  it("leaves invented names and expanded job titles unknown without losing the relationship", () => {
    const output = parseMeetingFollowup(JSON.stringify({ ...result, connections: [{ ...connection, name: "Corporate GPU Division", title: "Managing Director" }] }), source);
    expect(output.connections?.[0]).toEqual(connection);
  });

  it("requires name independent context so speaker corrections cannot leave stale prose", () => {
    const output = { ...result, connections: [{ ...connection, context: "Alice works with the debt team." }] };
    expect(() => parseMeetingFollowup(JSON.stringify(output), source)).toThrow("speaker names");
    expect(parseMeetingFollowup(JSON.stringify(output), source, { lenient: true }).connections).toEqual([]);
  });

  it.each([2, 3, 4])("keeps version %s summaries readable without inventing connections", (version) => {
    const legacy = { todos: [], dynamics: [], research: [] };
    const meeting = { ...saved(), aiFollowup: { sourceHash: createHash("sha256").update(JSON.stringify([version, source])).digest("hex"), result: legacy } };
    expect(getCurrentMeetingFollowup(meeting)).toEqual(legacy);
    expect(getCurrentMeetingConnections(meeting)).toEqual([]);
    expect(getCurrentMeetingFollowup({ ...meeting, title: "Changed" })).toBeNull();
  });

  it("validates against canonical source while allowing a shared reader's display aliases", () => {
    const meeting = { ...saved(), title: "Reader's title", segments: source.segments.map(s => ({ ...s, speaker: "Local alias" })), followupSource: source };
    expect(getCurrentMeetingConnections(meeting)).toEqual([connection]);
    expect(getCurrentMeetingConnections({ ...meeting, followupSource: { ...source, segments: source.segments.slice(1) } })).toEqual([]);
  });
});


describe("connection corrections", () => {
  const original = parseMeetingFollowup(JSON.stringify(result), source).connections![0];
  const changes = { kind: original.kind, name: "Corrected contact", company: "Corrected company", title: "Partner",
    relationship: original.relationship, context: "Corrected description", speakerSegmentId: "b", mutual: true };
  it("preserves human identity and attribution corrections on reload and speaker rename without changing evidence", () => {
    const meeting = saved();
    const corrected = { ...meeting, aiFollowup: { ...meeting.aiFollowup, connectionEdits: [{ original, changes }] } };
    const readback = getCurrentMeetingConnections(corrected);
    expect(readback).toEqual([{ ...original, ...changes }]);
    expect(getCurrentMeetingConnections({ ...corrected, segments: source.segments.map(s => s.id === "b" ? { ...s, speaker: "Robert" } : s) })).toEqual(readback);
    expect(getCurrentMeetingFollowup(corrected)?.connections).toEqual(readback);
  });
  it("keeps edits when regeneration changes context or omits a corrected lead", () => {
    const edits = [{ original, changes }];
    expect(applyConnectionEdits([{ ...original, context: "New machine wording" }], edits)).toEqual([{ original, connection: { ...original, ...changes } }]);
    expect(applyConnectionEdits([], edits)).toEqual([{ original, connection: { ...original, ...changes } }]);
  });
  it("does not merge distinct unnamed leads or reapply edits after source membership changes", () => {
    const entries = applyConnectionEdits([original, { ...original, context: "Another unnamed team", evidence: [{ segmentId: "c" }], speakerSegmentId: "c" }], [{ original, changes }]);
    expect(entries).toHaveLength(2);
    expect(entries[1].connection.context).toBe("Another unnamed team");
    const meeting = saved();
    expect(getCurrentMeetingConnections({ ...meeting, segments: source.segments.slice(1), aiFollowup: { ...meeting.aiFollowup, connectionEdits: [{ original, changes }] } })).toEqual([]);
  });
  it("never replaces one manual correction with another when regenerated leads become ambiguous", () => {
    const other = { ...original, context: "A distinct specialist team" };
    const entries = applyConnectionEdits([{ ...original, context: "Generic new wording" }], [
      { original, changes }, { original: other, changes: { ...changes, name: "Other contact" } },
    ]);
    expect(entries.map(entry => entry.connection.name)).toEqual(["Corrected contact", "Other contact"]);
  });
  it("reserves mutual confirmation for user corrections even with multiple cited speakers", () => {
    for (const evidence of [[{ segmentId: "a" }], [{ segmentId: "a" }, { segmentId: "b" }]]) {
      expect(parseMeetingFollowup(JSON.stringify({ ...result, connections: [{ ...original, mutual: true, evidence }] }), source).connections![0].mutual).toBe(false);
    }
    expect(applyConnectionEdits([original], [{ original, changes }])[0].connection.mutual).toBe(true);
  });
  it("keeps a unique named correction when regeneration changes anchor within overlapping evidence", () => {
    const named = { ...original, name: "Morgan", evidence: [{ segmentId: "a" }, { segmentId: "c" }] };
    const moved = { ...named, speakerSegmentId: "c" };
    const context = { ...source, segments: [...source.segments, { ...source.segments[0], id: "c" }] };
    expect(applyConnectionEdits([moved], [{ original: named, changes }], context)).toEqual([{ original: named, connection: { ...named, ...changes } }]);
    expect(applyConnectionEdits([moved, moved], [{ original: named, changes }], context)).toHaveLength(3);
    expect(applyConnectionEdits([{ ...moved, speakerSegmentId: "b" }], [{ original: named, changes }], context)).toHaveLength(2);
  });
  it("keeps revision tokens stable when JSONB reorders persisted object keys", () => {
    const meeting = { ...saved(), aiFollowup: { ...saved().aiFollowup, connectionEdits: [{ original, changes }] } };
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
    expect(getConnectionsRevision({ ...meeting, aiFollowup: reorder(meeting.aiFollowup) })).toBe(getConnectionsRevision(meeting));
  });
  it("does not trust legacy AI mutual markers after speaker labels are merged", () => {
    const mutual = { ...original, mutual: true, evidence: [{ segmentId: "a" }, { segmentId: "b" }] };
    const meeting = saved();
    const savedMutual = { ...meeting, aiFollowup: { ...meeting.aiFollowup, result: { ...result, connections: [mutual] } } };
    expect(getCurrentMeetingConnections({ ...savedMutual, segments: source.segments.map(s => ({ ...s, speaker: "Renamed" })) })).toEqual([{ ...mutual, mutual: false }]);
  });
  it("recognizes organization domains without guessing from first names or ambiguous names", () => {
    const people = [{ name: "Yiping Lu", email: "yiping@iosf.vc" }, { name: "Alice", email: "alice@citi.com" }];
    expect(isOrganizationSpeaker("Yiping Lu", people, ["iosg.vc", "iosf.vc"])).toBe(true);
    expect(isOrganizationSpeaker("Alice", people, ["iosg.vc", "iosf.vc"])).toBe(false);
    expect(isOrganizationSpeaker("Yiping", people, ["iosg.vc", "iosf.vc"])).toBe(false);
    expect(isOrganizationSpeaker("Yiping Lu", [...people, { name: "Yiping Lu", email: "other@external.com" }], ["iosf.vc"])).toBe(false);
  });
});

it("keeps a supported organization spelling without adding an unrelated history hint", () => {
  const source = { title: "Discussion", startedAt: null, segments: [{ id: "seg", speaker: "Jane", startMs: 0, text: "I met North Star Labs." }] };
  const lead = { kind: "organization", name: "NorthStar Labs", company: "Unrelated Corp", title: null, relationship: "met", context: "Met at the event.", evidence: [{ segmentId: "seg" }], speakerSegmentId: "seg" };
  expect(parseMeetingConnections([lead], source)[0]).toMatchObject({ kind: "organization", name: "NorthStar Labs", company: null });
});
