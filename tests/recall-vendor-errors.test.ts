import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecallCalendar,
  createRecallDesktopSdkUpload,
  deleteRecallCalendar,
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  findRecallRecordingMediaUrl,
  findRecallSpeakerTimelineUrl,
  listRecallCalendarEvents,
  listRecallCalendars,
  retrieveRecallBot,
  retrieveRecallCalendar,
  retrieveRecallRecording,
  scheduleRecallBot,
  scheduleRecallCalendarEventBot,
  sendRecallChatMessage,
  updateRecallCalendar,
  updateScheduledRecallBot,
} from "@/lib/vendors/recall";

const calendarInput = {
  oauthClientId: "client_id",
  oauthClientSecret: "client_secret",
  oauthRefreshToken: "refresh_token",
  platform: "google_calendar" as const,
};

describe("Recall vendor failure contracts", () => {
  beforeEach(() => {
    vi.stubEnv("RECALL_API_KEY", "recall_key");
    vi.stubEnv("RECALL_API_BASE_URL", "https://us-east-1.recall.ai");
    vi.stubEnv("RECALL_WEBHOOK_SECRET", "whsec_cmVjYWxsLXdlYmhvb2stc2VjcmV0");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["bot scheduling", () => scheduleRecallBot({ meetingUrl: "https://meet.google.com/a-b-c", avatarJpegBase64: "avatar", webhookUrl: "https://app.example.com/webhook" }), "Recall bot scheduling failed"],
    ["SDK upload", () => createRecallDesktopSdkUpload({ webhookUrl: "https://app.example.com/webhook" }), "Recall Desktop SDK upload creation failed"],
    ["recording retrieval", () => retrieveRecallRecording("recording/1"), "Recall recording retrieval failed"],
    ["calendar creation", () => createRecallCalendar(calendarInput), "Recall calendar creation failed"],
    ["calendar update", () => updateRecallCalendar({ calendarId: "calendar/1", metadata: { teamId: "team_1" } }), "Recall calendar update failed"],
    ["calendar deletion", () => deleteRecallCalendar({ calendarId: "calendar/1" }), "Recall calendar deletion failed"],
    ["calendar listing", () => listRecallCalendars(), "Recall calendar listing failed"],
    ["calendar retrieval", () => retrieveRecallCalendar("calendar/1"), "Recall calendar retrieval failed"],
    ["event listing", () => listRecallCalendarEvents({ calendarId: "calendar/1", isDeleted: false }), "Recall calendar event listing failed"],
    ["calendar bot scheduling", () => scheduleRecallCalendarEventBot({ calendarEventId: "event/1", deduplicationKey: "event_1", avatarJpegBase64: "avatar" }), "Recall calendar bot scheduling failed"],
    ["calendar bot deletion", () => deleteRecallCalendarEventBot({ calendarEventId: "event/1" }), "Recall calendar bot deletion failed"],
    ["bot update", () => updateScheduledRecallBot({ botId: "bot/1", meetingUrl: "https://meet.google.com/a-b-c", avatarJpegBase64: "avatar", startAt: "2026-07-20T12:00:00.000Z" }), "Recall bot update failed"],
    ["bot deletion", () => deleteScheduledRecallBot({ botId: "bot/1" }), "Recall bot deletion failed"],
    ["chat send", () => sendRecallChatMessage({ botId: "bot/1", message: "hello" }), "Recall chat message send failed"],
    ["bot retrieval", () => retrieveRecallBot("bot/1"), "Recall bot retrieval failed"],
  ])("reports a vendor error for %s", async (_name, operation, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(null, { status: 503, statusText: "Unavailable" }),
    ));

    await expect(operation()).rejects.toThrow(`${message} with 503 Unavailable`);
  });

  it("handles JSON and empty success responses", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(Response.json({ id: "recording_1" }));
    await expect(retrieveRecallRecording("recording_1")).resolves.toEqual({ id: "recording_1" });

    fetchMock.mockResolvedValueOnce(Response.json({ id: "calendar_1" }));
    await expect(updateRecallCalendar({ calendarId: "calendar_1" })).resolves.toEqual({ id: "calendar_1" });

    fetchMock.mockResolvedValueOnce(Response.json({ deleted: true }));
    await expect(deleteRecallCalendar({ calendarId: "calendar_1" })).resolves.toEqual({ deleted: true });

    fetchMock.mockResolvedValueOnce(Response.json({ id: "calendar_1" }));
    await expect(retrieveRecallCalendar("calendar_1")).resolves.toEqual({ id: "calendar_1" });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteRecallCalendarEventBot({ calendarEventId: "event_1" })).resolves.toEqual({});

    fetchMock.mockResolvedValueOnce(Response.json({ deleted: true }));
    await expect(deleteRecallCalendarEventBot({ calendarEventId: "event_1" })).resolves.toEqual({ deleted: true });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(updateScheduledRecallBot({
      botId: "bot_1",
      meetingUrl: "https://meet.google.com/a-b-c",
      avatarJpegBase64: "avatar",
      startAt: "2026-07-20T12:00:00.000Z",
    })).resolves.toEqual({});

    fetchMock.mockResolvedValueOnce(Response.json({ deleted: true }));
    await expect(deleteScheduledRecallBot({ botId: "bot_1" })).resolves.toEqual({ deleted: true });
  });

  it("returns null for malformed recording media collections", () => {
    expect(findRecallRecordingMediaUrl(null)).toBeNull();
    expect(findRecallRecordingMediaUrl({ recordings: "invalid" })).toBeNull();
    expect(findRecallRecordingMediaUrl({ recordings: [null, {}] })).toBeNull();
    expect(findRecallRecordingMediaUrl({ id: "recording_1" }, "other")).toBeNull();

    expect(findRecallSpeakerTimelineUrl(null)).toBeNull();
    expect(findRecallSpeakerTimelineUrl({ recordings: "invalid" })).toBeNull();
    expect(findRecallSpeakerTimelineUrl({ recordings: [null, {}] })).toBeNull();
    expect(findRecallSpeakerTimelineUrl({ id: "recording_1" }, "other")).toBeNull();
  });

  it("reads direct and nested speaker timeline URLs", () => {
    expect(findRecallSpeakerTimelineUrl({
      id: "recording_1",
      speaker_timeline_download_url: " https://cdn.example.com/direct.json ",
    }, "recording_1")).toBe("https://cdn.example.com/direct.json");

    expect(findRecallSpeakerTimelineUrl({
      id: "recording_1",
      media_shortcuts: {
        participant_events: { data: null },
        speaker_timeline: { data: null },
      },
    }, "recording_1")).toBeNull();
  });
});
