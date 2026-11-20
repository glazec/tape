import { createHmac } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  getComposedMeetingForFollowup: vi.fn(),
  getCurrentMeetingFollowup: vi.fn(),
  getMeetingTodoControls: vi.fn(),
  getPersonIdentity: vi.fn(),
  getStoredPersonProfile: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/meeting-composition", () => ({
  getComposedMeetingForFollowup: mocks.getComposedMeetingForFollowup,
}));
vi.mock("@/lib/meeting-followup-source", () => ({
  getCurrentMeetingFollowup: mocks.getCurrentMeetingFollowup,
  storedFollowupSchema: { parse: (value: unknown) => value },
}));
vi.mock("@/lib/people", () => ({ getPersonIdentity: mocks.getPersonIdentity, getMeetingTodoControls: mocks.getMeetingTodoControls }));
vi.mock("@/lib/person-profile", () => ({ getStoredPersonProfile: mocks.getStoredPersonProfile }));

import { POST } from "@/app/api/mcp/read/route";

const secret = "test-mcp-backend-secret-at-least-32-characters";
const personId = "11111111-1111-4111-8111-111111111111";
const meetingId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const teamId = "44444444-4444-4444-8444-444444444444";
const dialect = new PgDialect();

function request(input: unknown, signed = true) {
  const body = JSON.stringify({ input, user: { id: "auth-user", email: "viewer@example.com", name: null } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`request-id.${timestamp}.${body}`).digest("base64url");
  return new Request("http://localhost/api/mcp/read", {
    method: "POST",
    headers: signed ? {
      "x-tape-mcp-id": "request-id",
      "x-tape-mcp-signature": `v1,${signature}`,
      "x-tape-mcp-timestamp": String(timestamp),
    } : {},
    body,
  });
}

function readRows(rows: unknown[]) {
  const builder = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  mocks.select.mockReturnValueOnce(builder);
  return builder;
}

describe("signed MCP reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("MCP_BACKEND_SHARED_SECRET", secret);
  });

  it("rejects unsigned requests and caller-supplied workspace context", async () => {
    const input = { operation: "followup", meetingId };
    expect((await POST(request(input, false))).status).toBe(401);
    expect((await POST(request({ ...input, teamId }))).status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(["transcript", "followup"])("blocks %s when the caller cannot read the meeting", async (operation) => {
    readRows([{ id: userId }]);
    const meeting = readRows([]);
    const pageParams = operation === "transcript" ? { limit: 50, offset: 0 } : {};
    const response = await POST(request({ operation, meetingId, ...pageParams }));
    expect(response.status).toBe(404);
    const condition = dialect.sqlToQuery(meeting.where.mock.calls[0][0]);
    expect(condition.sql).toContain("revoked_at");
    expect(condition.sql).toContain("owner_user_id");
    expect(condition.params).toContain("cancelled");
    expect(mocks.getComposedMeetingForFollowup).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it("pages timestamped segments only from the active recording generation", async () => {
    readRows([{ id: userId }]);
    readRows([{ id: meetingId, teamId, title: "Friday IC", status: "ready" }]);
    const segment = { id: "s1", start_ms: 100, text: "First line" };
    const transcript = readRows([segment, { id: "s2", start_ms: 200, text: "Second line" }]);
    const response = await POST(request({ operation: "transcript", meetingId, limit: 1, offset: 5 }));
    expect(await response.json()).toEqual({
      meeting: { id: meetingId, title: "Friday IC", status: "ready" },
      segments: [segment],
      next_offset: 6,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const condition = dialect.sqlToQuery(transcript.where.mock.calls[0][0]).sql;
    expect(condition).toContain("latest_replace");
    expect(condition).toContain("current_jobs.mode = 'append'");
    expect(condition).toContain("revoked_at");
    expect(transcript.limit).toHaveBeenCalledWith(2);
    expect(transcript.offset).toHaveBeenCalledWith(5);
  });

  it("returns only the validated saved AI followup", async () => {
    readRows([{ id: userId }]);
    readRows([{ id: meetingId, teamId, title: "Friday IC", status: "ready" }]);
    const composed = { status: "ready", aiFollowup: { internal: true } };
    mocks.getComposedMeetingForFollowup.mockResolvedValue(composed);
    mocks.getCurrentMeetingFollowup.mockReturnValue(null);
    const response = await POST(request({ operation: "followup", meetingId }));
    expect(await response.json()).toEqual({
      meeting: { id: meetingId, title: "Friday IC", status: "ready" },
      followup: null,
    });
    expect(mocks.getCurrentMeetingFollowup).toHaveBeenCalledWith(composed);
  });

  it("finds dated commitments using the current assignee and the original item status", async () => {
    readRows([{ id: userId }]);
    const candidate = { id: meetingId, teamId, title: "October review", at: "2026-10-25T12:00:00Z" };
    const candidates = readRows([candidate, { ...candidate, id: "next" }]);
    const old = { person: "Speaker 1", text: "Speaker 1 will send the draft" };
    mocks.getComposedMeetingForFollowup.mockResolvedValue({ status: "ready", aiFollowup: { result: { todos: [old] } } });
    mocks.getCurrentMeetingFollowup.mockReturnValue({ todos: [{ ...old, person: "Alex", text: "Alex will send the draft" }] });
    mocks.getMeetingTodoControls.mockResolvedValue([{ status: "done" }]);
    const input = { operation: "todos", start: "2026-10-22", end: "2026-10-29", meetingId: null,
      assignee: "alex", status: "done", limit: 1, offset: 0 };
    const response = await POST(request(input));
    expect(await response.json()).toEqual({ next_offset: 1, todos: [{
      meeting_id: meetingId, meeting_title: candidate.title, meeting_at: candidate.at,
      assignee: "Alex", action: "Alex will send the draft", status: "done",
    }] });
    expect(mocks.getMeetingTodoControls).toHaveBeenCalledWith(meetingId, [old]);
    const condition = dialect.sqlToQuery(candidates.where.mock.calls[0][0]);
    expect(condition.sql).toContain("is_internal_member");
    expect(condition.params).toEqual(expect.arrayContaining([input.start, input.end]));
    readRows([{ id: userId }]);
    readRows([candidate]);
    expect(await (await POST(request({ ...input, status: "todo" }))).json()).toEqual({ todos: [], next_offset: null });
  });

  it("lists only active people scoped to explicit internal workspace membership", async () => {
    readRows([{ id: userId }]);
    const person = { id: personId, team_id: teamId, name: "Priya" };
    const directory = readRows([person, { id: "second", name: "Priya M" }]);
    const response = await POST(request({ operation: "search_people", query: "Priya", limit: 1 }));
    expect(await response.json()).toEqual({ people: [person], has_more: true });
    const condition = dialect.sqlToQuery(directory.where.mock.calls[0][0]);
    expect(condition.sql).toContain("app_private.is_internal_member");
    expect(condition.sql).toContain("merged_into_id");
    expect(condition.params).toContain("Priya");
  });

  it("returns an existing profile for the canonical person only after membership lookup", async () => {
    readRows([{ id: userId }]);
    const inaccessible = readRows([]);
    const input = { operation: "person_profile", personId };
    expect((await POST(request(input))).status).toBe(404);
    expect(dialect.sqlToQuery(inaccessible.where.mock.calls[0][0]).sql).toContain("app_private.is_internal_member");
    expect(mocks.getStoredPersonProfile).not.toHaveBeenCalled();

    readRows([{ id: userId }]);
    readRows([{ teamId }]);
    const canonicalId = "55555555-5555-4555-8555-555555555555";
    const person = { id: canonicalId, name: "Priya" };
    const profile = { profile: { headline: "Engineer" }, sourceMeetings: [] };
    mocks.getPersonIdentity.mockResolvedValueOnce({ kind: "merged", personId: canonicalId });
    mocks.getPersonIdentity.mockResolvedValueOnce({ kind: "found", data: { person } });
    mocks.getStoredPersonProfile.mockResolvedValue(profile);
    const response = await POST(request(input));
    expect(await response.json()).toEqual({ person, profile });
    expect(mocks.getStoredPersonProfile).toHaveBeenCalledWith({ userId, teamId, domain: "example.com" }, canonicalId);
  });
});
