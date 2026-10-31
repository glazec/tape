import { afterEach, describe, expect, it, vi } from "vitest";
const { databaseSql } = vi.hoisted(() => ({ databaseSql: Object.assign(vi.fn(), { transaction: vi.fn() }) }));
vi.mock("@/db/client", () => ({ databaseSql }));
vi.mock("@/lib/meeting-share-rules", () => ({ reconcileMeetingSharingForMeeting: vi.fn() }));
import { listLocalRecorderRecordingMeetings, setLocalRecorderRecordingTarget } from "@/lib/local-recorder-targets";
const workspace = { teamId: "team", userId: "user", domain: "", canCreateMeetings: true };
afterEach(() => { databaseSql.mockReset(); databaseSql.transaction.mockReset(); });
describe("recording targets", () => {
  it("pages the meetings the person is in and preserves nullable schedule fields", async () => {
    databaseSql.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ meetingId: String(i), title: "Old meeting", startsAt: null, endsAt: null, status: "ready" })));
    const result = await listLocalRecorderRecordingMeetings({ workspace, query: "Old", offset: 100 });
    expect(result.meetings).toHaveLength(100);
    expect(result.hasMore).toBe(true);
    expect(result.meetings[0].startsAt).toBeNull();
    const query = databaseSql.mock.calls[0][0].join("?");
    expect(query).toContain("m.owner_user_id = ");
    // Attended meetings count only through active participant access, never a bare admin role.
    expect(query).toContain("ma.source = 'participant' and ma.revoked_at is null)\n        and exists");
    expect(query).not.toMatch(/or exists \(\s*select 1 from team_memberships/);
    expect(databaseSql.mock.calls[0]).toContain(100);
  });
  it("rejects a shared only workspace before writing", async () => {
    await expect(setLocalRecorderRecordingTarget({ workspace: { ...workspace, canCreateMeetings: false }, deviceId: "mac", now: new Date() })).rejects.toThrow("Shared users");
    expect(databaseSql.transaction).not.toHaveBeenCalled();
  });
  it.each([undefined, "same-token"])("returns the selected target and preserves an active token %s", async (fallbackIntentId) => {
    databaseSql.transaction.mockResolvedValue([[], [], [{ meetingId: "meeting", meetingTitle: "Review", startsAt: null, endsAt: null }]]);
    const result = await setLocalRecorderRecordingTarget({ workspace, deviceId: "mac", now: new Date(), meetingId: "meeting", fallbackIntentId });
    expect(result.meetingId).toBe("meeting");
    expect(result.fallbackIntentId).toEqual(fallbackIntentId ?? expect.any(String));
  });
  it("rejects inaccessible, cancelled, stopped or competing targets without creating an orphan", async () => {
    databaseSql.transaction.mockResolvedValue([[], [], []]);
    await expect(setLocalRecorderRecordingTarget({ workspace, deviceId: "mac", now: new Date(), fallbackIntentId: "stopped", title: "New" })).rejects.toThrow("unavailable");
  });
});
