import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseSql, autoJoinCalendarEvent, fetchGoogleCalendarEvent, fetchGoogleCalendarHistoryEventIds, refreshStoredGoogleCalendarAccessToken } = vi.hoisted(() => ({
  databaseSql: vi.fn(), autoJoinCalendarEvent: vi.fn(), fetchGoogleCalendarEvent: vi.fn(),
  fetchGoogleCalendarHistoryEventIds: vi.fn(),
  refreshStoredGoogleCalendarAccessToken: vi.fn(),
}));
vi.mock("@/db/client", () => ({ databaseSql, db: {} }));
vi.mock("@/lib/calendar-auto-join", () => ({ autoJoinCalendarEvent }));
vi.mock("@/lib/google-calendar-events", () => ({ fetchGoogleCalendarEvent, fetchGoogleCalendarHistoryEventIds }));
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

  it("discovers Olivia even without a stored calendar record and skips existing meetings", async () => {
    databaseSql.mockResolvedValueOnce([{ oauth_refresh_token: "encrypted" }])
      .mockResolvedValueOnce([{ external_event_id: "already-linked" }]);
    fetchGoogleCalendarHistoryEventIds.mockResolvedValue(["already-linked", "olivia-not-imported", "imported-without-meeting"]);
    expect(await listMissingCalendarHistory(input)).toEqual(["olivia-not-imported", "imported-without-meeting"]);
    expect(fetchGoogleCalendarHistoryEventIds).toHaveBeenCalledWith({
      accessToken: "access-token", timeMin: new Date("2026-09-02T21:00:00.000Z"),
      timeMax: new Date(input.requestedAt),
    });
    const [parts, ...params] = databaseSql.mock.calls[1];
    expect(parts.join("?")).toContain("and exists");
    expect(parts.join("?")).toContain("m.team_meeting_key = e.team_meeting_key");
    expect(params).toContain(input.userId);
    expect(params).toContain(input.teamId);
    fetchGoogleCalendarEvent.mockResolvedValue({ ...googleEvent, summary: "Olivia" });
    await expect(repairCalendarHistoryEvent(input, "olivia-not-imported")).resolves.toEqual({ action: "repaired" });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      historicalRepair: true, event: expect.objectContaining({ title: "Olivia", externalEventId: "olivia-not-imported" }),
    }));
  });

  it("does not list Google history for a disconnected or mismatched connection", async () => {
    databaseSql.mockResolvedValue([]);
    expect(await listMissingCalendarHistory(input)).toEqual([]);
    expect(fetchGoogleCalendarHistoryEventIds).not.toHaveBeenCalled();
  });

  it("retries discovery instead of silently omitting events when Google fails", async () => {
    fetchGoogleCalendarHistoryEventIds.mockRejectedValue(new Error("Google unavailable"));
    await expect(listMissingCalendarHistory(input)).rejects.toThrow("Google unavailable");
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
