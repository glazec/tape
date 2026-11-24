import { createHash } from "node:crypto";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { FOLLOWUP_PROMPT_VERSION, type FollowupSource } from "@/lib/meeting-followup";
import { getConnectionsSourceHash, getCurrentMeetingFollowup, getFollowupSource, getFollowupSourceHash } from "@/lib/meeting-followup-source";

const dbMocks = vi.hoisted(() => ({ select: vi.fn(), listAliases: vi.fn() }));
vi.mock("@/db/client", () => ({ databaseSql: vi.fn(), db: { select: dbMocks.select } }));
vi.mock("@/lib/speaker-aliases", () => ({ listMeetingSpeakerAliases: dbMocks.listAliases }));
import { composeMeetingForFollowup, getComposedMeetingForFollowup, getMeetingCompositionForWorkspace } from "@/lib/meeting-composition";

const primaryId = "11111111-1111-4111-8111-111111111111";
const secondaryId = "22222222-2222-4222-8222-222222222222";
const teamId = "33333333-3333-4333-8333-333333333333";
const workspace = { userId: primaryId, teamId, domain: "example.com" };

function mockFollowupReads(canManage: boolean, recordedPartStarts: Array<Date | null>, includeSource: boolean) {
  const rows = [primaryId, secondaryId].map((id, index) => ({
    id, teamId, title: index === 0 ? "  Customer   call  " : "Second call",
    status: "ready", transcriptJobStatus: "completed",
    startedAt: new Date(index === 0 ? "2026-11-01T09:00:00Z" : "2026-11-01T10:00:00Z"),
    recordedStartedAt: new Date(index === 0 ? "2026-11-01T12:00:00Z" : "2026-11-01T10:30:00Z"),
    createdAt: new Date("2026-11-01T08:00:00Z"),
    updatedAt: new Date("2026-11-01T14:00:00Z"),
    recordedEndedAt: new Date("2026-11-01T13:00:00Z"),
    attributionRevision: index, lastSpeakerEditMs: index + 100, canManage,
    calendarAttendeeEmails: [], aiFollowup: { result: {} },
  }));
  dbMocks.listAliases.mockReset();
  dbMocks.listAliases.mockResolvedValue([{ alias: "speaker@example.com", canonicalName: "Alice" }]);
  dbMocks.select.mockImplementation((fields: Record<string, unknown>) => {
    let id = primaryId;
    let source = "";
    const builder = {
      from: (table: typeof import("@/db/schema").meetings) => {
        source = getTableName(table);
        return builder;
      },
      leftJoin: () => builder,
      innerJoin: () => builder,
      where: (condition: SQL) => {
        const params = new PgDialect().sqlToQuery(condition).params;
        if (params[0] === secondaryId) id = secondaryId;
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      then: (resolve: (rows: unknown[]) => unknown) => {
        const meeting = rows.find(row => row.id === id)!;
        let data: unknown[] = [];
        if (source === "meetings") data = [meeting];
        if (source === "meeting_parts" && "kind" in fields && includeSource) data = [rows[1]];
        if (source === "recordings" && id === primaryId) {
          data = recordedPartStarts.map(startedAt => ({ startedAt, durationMs: null, endedAt: null }));
        }
        if (source === "transcript_segments") {
          data = [{ id, speaker: "speaker@example.com", meetingSpeakerId: null, startMs: 0, text: meeting.title }];
        }
        return Promise.resolve(data).then(resolve);
      },
    };
    return builder;
  });
}

const legacy: FollowupSource = { title: "Call", startedAt: null, segments: [
  { id: "s1", speaker: "Alice", startMs: 0, text: "I will send the memo." },
] };
const renamed: FollowupSource = { ...legacy, attributionRevision: 0, segments: [
  { ...legacy.segments[0], speaker: "Alex", sourceSpeaker: "Alice", meetingSpeakerId: "g1", personId: "p1" },
] };
const result = { todos: [{ person: "Alice", text: "Alice will send the memo.", timing: null,
  evidence: [{ segmentId: "s1", quote: "I will send the memo." }] }], dynamics: [], research: [] };

describe("followup speaker identity source integrity", () => {
  it("rejects malformed meeting IDs before querying composition", async () => {
    dbMocks.select.mockClear();
    expect(await getComposedMeetingForFollowup(workspace, "invalid-meeting")).toBeNull();
    expect(dbMocks.select).not.toHaveBeenCalled();
  });

  it.each([
    { canManage: true, includeSource: true, recordingStarts: ["2026-11-01T11:00:00Z", "2026-11-01T12:00:00Z"] },
    { canManage: false, includeSource: false, recordingStarts: [] },
    { canManage: false, includeSource: true, recordingStarts: [null, "2026-11-01T12:00:00Z"] },
  ])("matches the full read for manager=$canManage linked source=$includeSource", async ({ canManage, includeSource, recordingStarts }) => {
    mockFollowupReads(canManage, recordingStarts.map(value => value === null ? null : new Date(value)), includeSource);
    const full = composeMeetingForFollowup((await getMeetingCompositionForWorkspace(workspace, primaryId))!);
    dbMocks.listAliases.mockClear();
    const lean = (await getComposedMeetingForFollowup(workspace, primaryId))!;

    expect(lean).toMatchObject({
      title: full.title, startedAt: full.startedAt, updatedAt: full.updatedAt,
      canManage, status: full.status, transcriptJobStatus: full.transcriptJobStatus,
      lastSpeakerEditMs: full.lastSpeakerEditMs, lastRecordingEndedAt: full.lastRecordingEndedAt,
      attributionRevision: full.attributionRevision, followupSource: full.followupSource,
      segments: full.segments.map(({ id, speaker, sourceSpeaker }) => ({ id, speaker, sourceSpeaker })),
    });
    expect(getFollowupSourceHash(lean)).toBe(getFollowupSourceHash(full));
    expect(getConnectionsSourceHash(lean)).toBe(getConnectionsSourceHash(full));
    expect(dbMocks.listAliases).toHaveBeenCalledTimes(canManage ? 2 : 0);
  });

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
