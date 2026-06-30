import { afterEach, describe, expect, it, vi } from "vitest";

const createLocalRecorderDeviceSession = vi.fn();
const getLocalRecorderWorkspace = vi.fn();
const listMissedLocalRecorderMeetings = vi.fn();
const claimLocalRecorderIntent = vi.fn();
const createLocalRecorderRecording = vi.fn();

vi.mock("@/lib/local-recorder-auth", () => ({
  createLocalRecorderDeviceSession,
  getLocalRecorderWorkspace,
}));

vi.mock("@/lib/local-recorder-records", () => ({
  claimLocalRecorderIntent,
  createLocalRecorderRecording,
  listMissedLocalRecorderMeetings,
}));

describe("local recorder API routes", () => {
  afterEach(() => {
    createLocalRecorderDeviceSession.mockReset();
    getLocalRecorderWorkspace.mockReset();
    listMissedLocalRecorderMeetings.mockReset();
    claimLocalRecorderIntent.mockReset();
    createLocalRecorderRecording.mockReset();
    vi.resetModules();
  });

  it("returns eligible missed meetings for a signed in Mac device", async () => {
    getLocalRecorderWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
    });
    listMissedLocalRecorderMeetings.mockResolvedValue([
      {
        displayTimeWindow: {
          endsAt: "2026-06-30T13:00:00.000Z",
          startsAt: "2026-06-30T12:00:00.000Z",
        },
        expiresAt: "2026-06-30T13:15:00.000Z",
        fallbackIntentId: "intent_123",
        title: "Weekly sync",
      },
    ]);

    const { GET } = await import(
      "@/app/api/local-recorder/missed-meetings/route"
    );
    const response = await GET(
      new Request("https://app.example.com/api/local-recorder/missed-meetings", {
        headers: { "x-local-recorder-device-id": "mac_123" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      meetings: [
        {
          displayTimeWindow: {
            endsAt: "2026-06-30T13:00:00.000Z",
            startsAt: "2026-06-30T12:00:00.000Z",
          },
          expiresAt: "2026-06-30T13:15:00.000Z",
          fallbackIntentId: "intent_123",
          title: "Weekly sync",
        },
      ],
    });
    expect(listMissedLocalRecorderMeetings).toHaveBeenCalledWith({
      deviceId: "mac_123",
      now: expect.any(Date),
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("claims a fallback intent before recording starts", async () => {
    getLocalRecorderWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
    });
    claimLocalRecorderIntent.mockResolvedValue({
      claimed: true,
      meetingTitle: "Weekly sync",
    });

    const { POST } = await import(
      "@/app/api/local-recorder/intents/[fallbackIntentId]/start/route"
    );
    const response = await POST(
      new Request(
        "https://app.example.com/api/local-recorder/intents/intent_123/start",
        {
          method: "POST",
          headers: { "x-local-recorder-device-id": "mac_123" },
        },
      ),
      { params: Promise.resolve({ fallbackIntentId: "intent_123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimed: true,
      meetingTitle: "Weekly sync",
    });
  });

  it("uploads two tracks and queues local recording processing", async () => {
    getLocalRecorderWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
    });
    createLocalRecorderRecording.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      queued: true,
    });

    const formData = new FormData();
    formData.set("fallbackIntentId", "intent_123");
    formData.set("clientRecordingId", "recording_123");
    formData.set("recordingStartedAt", "2026-06-30T12:02:00.000Z");
    formData.set("recordingStoppedAt", "2026-06-30T13:00:00.000Z");
    formData.set("manifest", JSON.stringify({ appVersion: "0.1.0" }));
    formData.set(
      "computerAudio",
      new File(["computer"], "computer.wav", { type: "audio/wav" }),
    );
    formData.set(
      "microphoneAudio",
      new File(["microphone"], "microphone.wav", { type: "audio/wav" }),
    );

    const { POST } = await import("@/app/api/local-recorder/recordings/route");
    const response = await POST(
      new Request("https://app.example.com/api/local-recorder/recordings", {
        method: "POST",
        body: formData,
        headers: { "x-local-recorder-device-id": "mac_123" },
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      meetingId: "11111111-1111-4111-8111-111111111111",
      queued: true,
    });
    expect(createLocalRecorderRecording).toHaveBeenCalledWith({
      clientRecordingId: "recording_123",
      computerAudio: expect.any(File),
      deviceId: "mac_123",
      fallbackIntentId: "intent_123",
      manifest: { appVersion: "0.1.0" },
      microphoneAudio: expect.any(File),
      recordingStartedAt: new Date("2026-06-30T12:02:00.000Z"),
      recordingStoppedAt: new Date("2026-06-30T13:00:00.000Z"),
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("returns 400 when the local recording manifest is invalid JSON", async () => {
    getLocalRecorderWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "user_123",
    });

    const formData = new FormData();
    formData.set("fallbackIntentId", "intent_123");
    formData.set("clientRecordingId", "recording_123");
    formData.set("recordingStartedAt", "2026-06-30T12:02:00.000Z");
    formData.set("recordingStoppedAt", "2026-06-30T13:00:00.000Z");
    formData.set("manifest", "{");
    formData.set(
      "computerAudio",
      new File(["computer"], "computer.wav", { type: "audio/wav" }),
    );
    formData.set(
      "microphoneAudio",
      new File(["microphone"], "microphone.wav", { type: "audio/wav" }),
    );

    const { POST } = await import("@/app/api/local-recorder/recordings/route");
    const response = await POST(
      new Request("https://app.example.com/api/local-recorder/recordings", {
        method: "POST",
        body: formData,
        headers: { "x-local-recorder-device-id": "mac_123" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid local recording upload",
    });
    expect(createLocalRecorderRecording).not.toHaveBeenCalled();
  });

  it("redirects signed in web users back to the Mac app with a device token", async () => {
    createLocalRecorderDeviceSession.mockResolvedValue({
      redirectUrl:
        "meetingnote-local-recorder://login?token=token_123&server=https%3A%2F%2Fapp.example.com",
    });

    const { GET } = await import(
      "@/app/api/local-recorder/device-login/route"
    );
    const response = await GET(
      new Request(
        "https://app.example.com/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "meetingnote-local-recorder://login?token=token_123&server=https%3A%2F%2Fapp.example.com",
    );
  });
});
