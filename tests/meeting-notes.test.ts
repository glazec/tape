import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  limit: vi.fn(),
  values: vi.fn(),
  conflict: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
  returning: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: mocks.where }) }),
    insert: () => ({ values: mocks.values }),
    update: () => ({ set: mocks.set }),
  },
}));
import {
  canReadMeetingNotes,
  getMeetingNote,
  saveMeetingNote,
} from "@/lib/meeting-notes";

const workspace = {
  userId: "user-one",
  teamId: "team-one",
  domain: "example.com",
};
const query = (condition: SQL) => new PgDialect().sqlToQuery(condition);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.values.mockReturnValue({ onConflictDoNothing: mocks.conflict });
  mocks.conflict.mockReturnValue({ returning: mocks.returning });
  mocks.set.mockReturnValue({ where: mocks.updateWhere });
  mocks.updateWhere.mockReturnValue({ returning: mocks.returning });
  mocks.limit.mockResolvedValue([]);
  mocks.returning.mockResolvedValue([]);
});

describe("personal note storage", () => {
  it("checks meeting access without requiring management or a completed recording", async () => {
    expect(await canReadMeetingNotes(workspace, "meeting-one")).toBe(false);
    const sql = query(mocks.where.mock.calls[0][0]);
    expect(sql.params).toContain("meeting-one");
    expect(sql.params).toContain("user-one");
    expect(sql.sql).toContain('"meeting_access"');
    expect(sql.sql).toContain('"revoked_at" is null');
    expect(sql.sql).not.toContain('"status"');
  });

  it("scopes reads to the meeting and current user", async () => {
    expect(await getMeetingNote(workspace, "meeting-one")).toEqual({
      content: "",
      version: 0,
      blocks: [{ id: "legacy", text: "" }],
    });
    const sql = query(mocks.where.mock.calls[0][0]);
    expect(sql.params).toEqual(["meeting-one", "user-one"]);
    expect(sql.sql).toContain('"meeting_notes"."user_id"');
  });

  it("does not overwrite a simultaneous first save", async () => {
    expect(
      await saveMeetingNote(workspace, "meeting-one", {
        content: "A",
        version: 0,
      }),
    ).toBeNull();
    expect(mocks.values).toHaveBeenCalledWith({
      meetingId: "meeting-one",
      userId: "user-one",
      content: "A",
    });
    expect(mocks.conflict).toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("updates only the current user's expected version", async () => {
    mocks.returning.mockResolvedValue([{ content: "Edited", version: 8 }]);
    expect(
      await saveMeetingNote(workspace, "meeting-one", {
        content: "Edited",
        version: 7,
      }),
    ).toEqual({ content: "Edited", version: 8, blocks: [{ id: "legacy", text: "Edited" }] });
    const sql = query(mocks.updateWhere.mock.calls[0][0]);
    expect(sql.params).toEqual(["meeting-one", "user-one", 7, "Edited"]);
    expect(sql.sql).toContain('"meeting_notes"."blocks" is null');
    expect(sql.sql).toContain('"meeting_notes"."content" =');
    expect(query(mocks.set.mock.calls[0][0].version).sql).toContain(
      '"meeting_notes"."version" + 1',
    );
  });

  it("saves structured answers and edited state under the same ownership and version guard", async () => {
    const blocks = [{ id: "one", text: "Check size?", answer: { question: "Check size?", text: "$2m", sources: [], transcriptRevision: "a".repeat(64), edited: true } }];
    mocks.returning.mockResolvedValue([{ content: "Check size?", version: 2, blocks }]);
    expect(await saveMeetingNote(workspace, "meeting-one", { content: "Check size?", version: 1, blocks })).toEqual({ content: "Check size?", version: 2, blocks });
    expect(mocks.set.mock.calls[0][0].blocks).toEqual(blocks);
    expect(query(mocks.updateWhere.mock.calls[0][0]).params).toEqual(["meeting-one", "user-one", 1]);
  });

  it("preserves blocks on same-content legacy saves and rejects changed structured notes", async () => {
    const blocks = [{ id: "one", text: "A" }];
    mocks.returning.mockResolvedValueOnce([{ content: "A", version: 2, blocks }]);
    expect(await saveMeetingNote(workspace, "meeting-one", { content: "A", version: 1 })).toMatchObject({ blocks });
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("blocks");
    const condition = query(mocks.updateWhere.mock.calls[0][0]);
    expect(condition.sql).toContain('"meeting_notes"."blocks" is null');
    expect(condition.sql).toContain('"meeting_notes"."content" =');
    mocks.returning.mockResolvedValueOnce([]);
    expect(await saveMeetingNote(workspace, "meeting-one", { content: "B", version: 2 })).toBeNull();
  });

  it("requires both personal ownership and meeting access in database policy and excludes MCP", () => {
    const migration = readFileSync(
      "db/migrations/0051_meeting_notes.sql",
      "utf8",
    );
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain('REVOKE ALL ON "meeting_notes" FROM tape_mcp');
    expect(migration).toContain(
      "USING (user_id = app_private.current_user_id() AND app_private.can_read_meeting(meeting_id))",
    );
    expect(migration).toContain(
      "WITH CHECK (user_id = app_private.current_user_id() AND app_private.can_read_meeting(meeting_id))",
    );
  });
});
