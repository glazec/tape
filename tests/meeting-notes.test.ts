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
    ).toEqual({ content: "Edited", version: 8 });
    const sql = query(mocks.updateWhere.mock.calls[0][0]);
    expect(sql.params).toEqual(["meeting-one", "user-one", 7]);
    expect(query(mocks.set.mock.calls[0][0].version).sql).toContain(
      '"meeting_notes"."version" + 1',
    );
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
