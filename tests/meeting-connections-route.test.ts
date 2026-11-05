import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), meeting: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: mocks.workspace }));
vi.mock("@/lib/meeting-composition", () => ({ getComposedMeetingForFollowup: mocks.meeting }));
vi.mock("@/db/client", () => ({ db: { update: () => ({ set: mocks.set }) } }));
import { GET, PATCH } from "@/app/api/meetings/[meetingId]/connections/route";
import { getConnectionsRevision, getConnectionsSourceHash, getCurrentMeetingConnections, getFollowupSourceHash } from "@/lib/meeting-followup-source";

const meetingId = "11111111-1111-4111-8111-111111111111";
const source = { title: "External meeting", startedAt: null, segments: [
  { id: "alice", speaker: "Alice", startMs: 0, text: "I know the GPU team." },
  { id: "bob", speaker: "Bob", startMs: 1000, text: "We have met." },
] };
const original = { kind: "team", name: null, company: null, title: null, relationship: "knows", context: "Knows the GPU team.", speakerSegmentId: "alice", evidence: [{ segmentId: "alice" }] };
const meeting = { ...source, updatedAt: "2026-10-31T00:00:00.000Z", status: "ready", transcriptJobStatus: "completed", canManage: true,
  aiFollowup: { sourceHash: getFollowupSourceHash(source), connectionsSourceHash: getConnectionsSourceHash(source), result: { todos: [], dynamics: [], research: [], connections: [original] } } };
const changes = { kind: "person", name: "Corrected name", company: "Corrected company", title: "Director", relationship: "knows", context: "User corrected the transcript error.", speakerSegmentId: "bob", mutual: true };
const context = { params: Promise.resolve({ meetingId }) };
const request = (extra = {}) => new Request("https://example.com/connections", { method: "PATCH", body: JSON.stringify({ revision: getConnectionsRevision(meeting), index: 0, changes, ...extra }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "user" }); mocks.workspace.mockResolvedValue({ userId: "user", teamId: "team" });
  mocks.meeting.mockResolvedValue(meeting); mocks.set.mockReturnValue({ where: mocks.where }); mocks.where.mockReturnValue({ returning: mocks.returning }); mocks.returning.mockResolvedValue([{ id: meetingId }]);
});
describe("connection edit API", () => {
  it("loads the latest revision and stable entry ids only for managers", async () => {
    const response = await GET(new Request("https://example.com/connections"), context);
    const body = await response.json();
    expect(body.revision).toBe(getConnectionsRevision(meeting));
    expect(body.connectionIds).toHaveLength(1);
    const corrected = await (await PATCH(request(), context)).json();
    expect(corrected.connectionIds).toEqual(body.connectionIds);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    mocks.meeting.mockResolvedValue({ ...meeting, canManage: false });
    expect((await GET(new Request("https://example.com/connections"), context)).status).toBe(404);
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request("https://example.com/connections"), context)).status).toBe(401);
  });
  it("saves corrected identities, descriptions, mutual markers and attribution separately from AI evidence", async () => {
    const response = await PATCH(request(), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connections).toEqual([{ ...original, ...changes }]);
    const aiFollowup = JSON.parse(JSON.stringify(mocks.set.mock.calls[0][0].aiFollowup));
    expect(aiFollowup.result.connections).toEqual([original]);
    expect(getCurrentMeetingConnections({ ...meeting, aiFollowup })).toEqual(body.connections);
    expect(body.revision).not.toBe(getConnectionsRevision(meeting));
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.sql).toContain('"ai_followup" ='); expect(query.sql).toContain('"updated_at" ='); expect(query.sql).toContain('"owner_user_id"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("keeps translated followups after a rename so the page stays in the reader's language", async () => {
    const translatedCopy = { todos: [], dynamics: [], research: [], connections: [{ ...original, context: "认识 GPU 团队。" }] };
    const translatedMeeting = { ...meeting, aiFollowup: { ...meeting.aiFollowup, translations: { "zh-CN": translatedCopy } } };
    mocks.meeting.mockResolvedValue(translatedMeeting);
    const rename = { ...changes, context: "认识 GPU 团队。" };
    const response = await PATCH(new Request("https://example.com/connections", { method: "PATCH", body: JSON.stringify({ revision: getConnectionsRevision(translatedMeeting), index: 0, changes: rename }) }), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    const aiFollowup = JSON.parse(JSON.stringify(mocks.set.mock.calls[0][0].aiFollowup));
    expect(aiFollowup.connectionEdits[0].changes.context).toBe(original.context);
    expect(aiFollowup.translations["zh-CN"].connections[0]).toMatchObject({ name: "Corrected name", kind: "person", context: "认识 GPU 团队。", evidence: original.evidence });
    expect(body.translatedConnections["zh-CN"][0]).toMatchObject({ name: "Corrected name", context: "认识 GPU 团队。" });
    expect(body.connections[0].context).toBe(original.context);
  });
  it("denies readers and unauthenticated users", async () => {
    mocks.user.mockResolvedValue(null); expect((await PATCH(request(), context)).status).toBe(401);
    mocks.user.mockResolvedValue({ id: "user" }); mocks.meeting.mockResolvedValue({ ...meeting, canManage: false }); expect((await PATCH(request(), context)).status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("rejects stale snapshots and invalid indexes without overwriting newer changes", async () => {
    expect((await PATCH(request({ revision: "0".repeat(64) }), context)).status).toBe(409);
    expect((await PATCH(request({ index: 4 }), context)).status).toBe(409);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("rejects unavailable speakers, source edits and unsupported fields", async () => {
    expect((await PATCH(request({ changes: { ...changes, speakerSegmentId: "hidden" } }), context)).status).toBe(400);
    expect((await PATCH(request({ changes: { ...changes, evidence: [] } }), context)).status).toBe(400);
    expect((await PATCH(request({ changes: { ...changes, context: " " } }), context)).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("blocks edits after transcript changes or while processing", async () => {
    mocks.meeting.mockResolvedValue({ ...meeting, status: "processing" }); expect((await PATCH(request(), context)).status).toBe(409);
    mocks.meeting.mockResolvedValue({ ...meeting, segments: [source.segments[0]] }); expect((await PATCH(request(), context)).status).toBe(409);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("reports concurrent writes and save errors truthfully", async () => {
    mocks.returning.mockResolvedValue([]); expect((await PATCH(request(), context)).status).toBe(409);
    mocks.returning.mockRejectedValue(new Error("database")); expect((await PATCH(request(), context)).status).toBe(500);
  });
});
