import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseSql, autoJoinCalendarEvent, fetchGoogleCalendarEvent, refreshStoredGoogleCalendarAccessToken } = vi.hoisted(() => ({
  databaseSql: vi.fn(), autoJoinCalendarEvent: vi.fn(), fetchGoogleCalendarEvent: vi.fn(),
  refreshStoredGoogleCalendarAccessToken: vi.fn(),
}));
vi.mock("@/db/client", () => ({ databaseSql, db: {} }));
vi.mock("@/lib/calendar-auto-join", () => ({ autoJoinCalendarEvent }));
vi.mock("@/lib/google-calendar-events", () => ({ fetchGoogleCalendarEvent }));
vi.mock("@/lib/google-calendar-oauth", () => ({ refreshStoredGoogleCalendarAccessToken }));

import { listMissingCalendarHistory, repairCalendarHistoryEvent } from "@/lib/calendar-history-repair";

const input = {
  connectionId: "11111111-1111-4111-8111-111111111111",
  teamId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  requestedAt: "2026-10-02T21:00:00.000Z",
};
const googleEvent = {
  summary: "Rui <> YP", location: "Mountain View, CA, USA",
  start: { dateTime: "2026-09-11T21:00:00Z" },
  end: { dateTime: "2026-09-11T22:00:00Z" },
  attendees: [{ email: "rui@example.com" }],
};

describe("calendar history repair", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    databaseSql.mockResolvedValue([{ oauth_refresh_token: "encrypted", email: "yiping@iosg.vc", name: "IOSG" }]);
    refreshStoredGoogleCalendarAccessToken.mockResolvedValue("access-token");
    fetchGoogleCalendarEvent.mockResolvedValue(googleEvent);
    autoJoinCalendarEvent.mockResolvedValue({ action: "repaired" });
  });

  it("selects only missing records within 30 days for the requesting connection", async () => {
    databaseSql.mockResolvedValue([{ external_event_id: "event-1" }]);
    expect(await listMissingCalendarHistory(input)).toEqual(["event-1"]);
    const [parts, ...params] = databaseSql.mock.calls[0];
    expect(parts.join("?")).toContain("not exists");
    expect(parts.join("?")).toContain("m.team_meeting_key = e.team_meeting_key");
    expect(params).toContain(input.userId);
    expect(params).toContain(input.teamId);
    expect(params).toContainEqual(new Date("2026-09-02T21:00:00.000Z"));
  });

  it("reads the updated Google event and restores it without enabling capture", async () => {
    expect(await repairCalendarHistoryEvent(input, "event-1")).toEqual({ action: "repaired" });
    expect(fetchGoogleCalendarEvent).toHaveBeenCalledWith("access-token", "event-1");
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      historicalRepair: true, repairMode: true,
      connection: expect.objectContaining({ autoJoinEnabled: false, userId: input.userId }),
      event: expect.objectContaining({
        externalEventId: "event-1", location: "Mountain View, CA, USA",
        attendeeEmails: ["rui@example.com"], recallCalendarEventId: undefined,
      }),
    }));
  });

  it("repairs the tesla appointment with a location but no participants or conferencing", async () => {
    fetchGoogleCalendarEvent.mockResolvedValue({
      summary: "tesla", location: "Mountain View, CA, USA",
      start: { dateTime: "2026-09-19T17:00:00-04:00" },
      end: { dateTime: "2026-09-19T18:00:00-04:00" },
    });
    await expect(repairCalendarHistoryEvent(input, "tesla-event")).resolves.toEqual({ action: "repaired" });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      historicalRepair: true,
      event: expect.objectContaining({
        title: "tesla", location: "Mountain View, CA, USA",
        attendeeEmails: [], meetingUrl: null,
        startsAt: "2026-09-19T17:00:00-04:00",
      }),
    }));
  });

  it.each([
    null,
    { ...googleEvent, status: "cancelled" },
    { ...googleEvent, start: { date: "2026-09-11" } },
    { ...googleEvent, start: { dateTime: "2026-08-01T21:00:00Z" } },
    { ...googleEvent, start: { dateTime: "2026-10-03T21:00:00Z" } },
    { ...googleEvent, end: { dateTime: "2026-10-03T21:00:00Z" } },
  ])("skips deleted, all-day, or rescheduled events outside the repair window", async (event) => {
    fetchGoogleCalendarEvent.mockResolvedValue(event);
    expect(await repairCalendarHistoryEvent(input, "event-1")).toEqual({ action: "skipped" });
    expect(autoJoinCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not use credentials after disconnect or an ownership mismatch", async () => {
    databaseSql.mockResolvedValue([]);
    expect(await repairCalendarHistoryEvent(input, "event-1")).toEqual({ action: "disconnected" });
    expect(refreshStoredGoogleCalendarAccessToken).not.toHaveBeenCalled();
  });

  it("propagates provider errors so the durable step retries", async () => {
    fetchGoogleCalendarEvent.mockRejectedValue(new Error("Google unavailable"));
    await expect(repairCalendarHistoryEvent(input, "event-1")).rejects.toThrow("Google unavailable");
    expect(autoJoinCalendarEvent).not.toHaveBeenCalled();
  });
});
