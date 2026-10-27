import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  workspace: vi.fn(),
  meeting: vi.fn(),
  credit: vi.fn(),
  creditResponse: vi.fn(),
  generate: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: mocks.workspace,
}));
vi.mock("@/lib/meeting-composition", () => ({
  getComposedMeetingForFollowup: mocks.meeting,
}));
vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: mocks.credit,
  providerCreditErrorResponse: mocks.creditResponse,
}));
vi.mock("@/lib/vendors/openrouter", () => ({
  generateMeetingFollowup: mocks.generate,
}));
vi.mock("@/db/client", () => ({ db: { update: () => ({ set: mocks.set }) } }));

import { POST } from "@/app/api/meetings/[meetingId]/followup/route";
import { getFollowupSourceHash } from "@/lib/meeting-followup-source";

const meetingId = "11111111-1111-4111-8111-111111111111";
const meeting = {
  title: "Discussion",
  startedAt: null,
  updatedAt: "2026-10-23T12:00:00Z",
  canManage: true,
  status: "ready",
  transcriptJobStatus: "completed",
  segments: [
    { id: "one", speaker: "Alex", startMs: 0, text: "I will send the deck." },
  ],
};
const context = { params: Promise.resolve({ meetingId }) };
const request = (sourceHash = getFollowupSourceHash(meeting)) =>
  new Request("https://example.com/followup", {
    method: "POST",
    body: JSON.stringify({ sourceHash }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.workspace.mockResolvedValue({ userId: "user", teamId: "team" });
  mocks.meeting.mockResolvedValue(meeting);
  mocks.generate.mockResolvedValue({ todos: [], dynamics: [] });
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: meetingId }]);
});

describe("meeting followup API", () => {
  it("rejects unauthenticated and invalid meeting requests", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    mocks.user.mockResolvedValue({ id: "user" });
    expect(
      (
        await POST(request(), {
          params: Promise.resolve({ meetingId: "invalid" }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.meeting).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each([null, { ...meeting, canManage: false }])(
    "denies inaccessible meetings and shared readers before provider work",
    async (value) => {
      mocks.meeting.mockResolvedValue(value);
      expect((await POST(request(), context)).status).toBe(404);
      expect(mocks.credit).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
    },
  );

  it("rejects an unfinished transcript and an outdated browser source", async () => {
    mocks.meeting.mockResolvedValue({
      ...meeting,
      transcriptJobStatus: "running",
    });
    expect((await POST(request(), context)).status).toBe(409);
    mocks.meeting.mockResolvedValue(meeting);
    expect((await POST(request("0".repeat(64)), context)).status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects caller supplied transcript or identity fields", async () => {
    const input = new Request("https://example.com/followup", {
      method: "POST",
      body: JSON.stringify({
        sourceHash: getFollowupSourceHash(meeting),
        transcript: "fake",
        userId: "other",
      }),
    });
    expect((await POST(input, context)).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("honors provider credit before generation", async () => {
    mocks.credit.mockRejectedValue(new Error("credit"));
    mocks.creditResponse.mockReturnValue(
      Response.json({ error: "Credit exhausted" }, { status: 402 }),
    );
    expect((await POST(request(), context)).status).toBe(402);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("saves a shared result with source fingerprint and manager guarded writes", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.set).toHaveBeenCalledWith({
      aiFollowup: {
        sourceHash: getFollowupSourceHash(meeting),
        result: { todos: [], dynamics: [] },
      },
    });
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.params).toEqual(
      expect.arrayContaining([meetingId, "team", "user", "ready"]),
    );
    expect(query.sql).toContain('"owner_user_id"');
    expect(query.sql).toContain('"updated_at"');
  });

  it.each([
    {
      ...meeting,
      segments: [{ ...meeting.segments[0], text: "Changed during generation" }],
    },
    { ...meeting, status: "processing" },
  ])(
    "does not save output if the source changes during generation",
    async (changed) => {
      mocks.meeting
        .mockResolvedValueOnce(meeting)
        .mockResolvedValueOnce(changed);
      expect((await POST(request(), context)).status).toBe(409);
      expect(mocks.set).not.toHaveBeenCalled();
    },
  );

  it("rechecks access after generation", async () => {
    mocks.meeting.mockResolvedValueOnce(meeting).mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("reports a lost write without claiming success", async () => {
    mocks.returning.mockResolvedValue([]);
    expect((await POST(request(), context)).status).toBe(409);
  });

  it("does not overwrite saved content after a provider or validation failure", async () => {
    mocks.generate.mockRejectedValue(new Error("invalid model response"));
    expect((await POST(request(), context)).status).toBe(502);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
