import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  select: vi.fn(),
  set: vi.fn(),
  sql: Object.assign(vi.fn(), { transaction: vi.fn() }),
  profile: vi.fn(),
  schedule: vi.fn(),
  retrieve: vi.fn(),
  manageable: vi.fn(),
  sources: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  databaseSql: m.sql,
  db: { select: m.select, update: () => ({ set: m.set }) },
}));
vi.mock("@/lib/meeting-composition", async () => ({
  ...(await import("@/lib/meeting-composition-error")),
  requireManageableComposition: m.manageable,
  listReadableMeetingSources: m.sources,
  isCompositionConflict: () => false,
}));
vi.mock("@/lib/meeting-bot-record-profile", () => ({
  getBotProfileForMeeting: m.profile,
}));
vi.mock("@/lib/meeting-bot-profile", () => ({
  getMeetingBotMetadata: () => ({}),
  getMeetingBotRecallCreateInput: (profile: unknown) => profile,
}));
vi.mock("@/lib/meeting-links", () => ({
  buildAppUrl: () => "http://localhost/webhook",
  detectBotSupportedMeetingPlatform: () => "zoom",
  resolveMeetingJoinUrl: (url: string) => url,
}));
vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({ assertCanCreateMeetings: vi.fn() }));
vi.mock("@/lib/vendors/recall", () => ({
  scheduleRecallBot: m.schedule,
  retrieveRecallBot: m.retrieve,
  RecallBotSchedulingError: class extends Error {
    constructor(public status: number) {
      super("Refused");
    }
  },
}));
import { continueMeetingRecording } from "@/lib/meeting-continuation";
import { RecallBotSchedulingError } from "@/lib/vendors/recall";
import type { WorkspaceContext } from "@/lib/workspace";
const workspace = { teamId: "team", userId: "owner" } as WorkspaceContext;
function rows(value: unknown[]) {
  const q = {
    from: () => q,
    where: () => q,
    orderBy: () => q,
    limit: async () => value,
  };
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.manageable.mockResolvedValue({ id: "root" });
  m.sources.mockResolvedValue([{ id: "previous" }]);
  m.select
    .mockReturnValueOnce(
      rows([
        {
          id: "recording",
          meetingId: "previous",
          externalBotId: "old-bot",
          endedAt: new Date(Date.now() - 1000),
        },
      ]),
    )
    .mockReturnValueOnce(
      rows([{ botDisplayName: "IOSG Old Friends", recallBotId: "old-bot" }]),
    );
  m.profile.mockResolvedValue({ botName: "IOSG Old Friends" });
  m.sql.mockResolvedValue([{ source_id: "child", claimed: true }]);
  m.schedule.mockResolvedValue({ id: "new-bot" });
  m.set.mockReturnValue({ where: async () => undefined });
});
describe("continuation dispatch", () => {
  it("keeps original lineage and sends the previous organization identity to a new source", async () => {
    await expect(
      continueMeetingRecording(workspace, "root", "https://zoom.us/j/123"),
    ).resolves.toEqual({ meetingId: "root", status: "joining" });
    expect(m.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        botName: "IOSG Old Friends",
        metadata: { meetingId: "child" },
      }),
    );
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "scheduled" }),
    );
  });
  it("does not send another bot while the first claim is unconfirmed", async () => {
    m.sql.mockResolvedValue([{ source_id: "child", claimed: false }]);
    m.select.mockReturnValueOnce(rows([{ recallBotId: null }]));
    await expect(
      continueMeetingRecording(workspace, "root", "https://zoom.us/j/123"),
    ).rejects.toThrow("still being confirmed");
    expect(m.schedule).not.toHaveBeenCalled();
  });
  it("retains an uncertain provider request and permits retry only after an explicit refusal", async () => {
    m.schedule.mockRejectedValue(new Error("Connection closed"));
    await expect(
      continueMeetingRecording(workspace, "root", "https://zoom.us/j/123"),
    ).rejects.toThrow("still being confirmed");
    expect(m.sql.transaction).not.toHaveBeenCalled();
  });
  it("marks a definite provider refusal retriable", async () => {
    m.schedule.mockRejectedValue(
      new RecallBotSchedulingError(400, "Bad Request"),
    );
    await expect(
      continueMeetingRecording(workspace, "root", "https://zoom.us/j/123"),
    ).rejects.toThrow("could not join");
    expect(m.sql.transaction).toHaveBeenCalledTimes(1);
  });
  it("rejects expiry before any claim or provider call", async () => {
    m.select
      .mockReset()
      .mockReturnValue(
        rows([{ id: "recording", endedAt: new Date(Date.now() - 3_600_000) }]),
      );
    await expect(
      continueMeetingRecording(workspace, "root", "https://zoom.us/j/123"),
    ).rejects.toThrow("one hour");
    expect(m.sql).not.toHaveBeenCalled();
    expect(m.schedule).not.toHaveBeenCalled();
  });
});
