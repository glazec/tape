import { afterEach, describe, expect, it, vi } from "vitest";

const createLocalRecorderDeviceSession = vi.fn();
const getLocalRecorderDeviceRequestContext = vi.fn();
const listMissedLocalRecorderMeetings = vi.fn();
const createManualLocalRecorderIntent = vi.fn();
const getLocalRecorderMonitoringStatus = vi.fn();
const claimLocalRecorderIntent = vi.fn();
const failLocalRecorderIntent = vi.fn();
const completeLocalRecorderRecordingUpload = vi.fn();
const prepareLocalRecorderRecordingUpload = vi.fn();
const createRecallDesktopSdkUploadForLocalRecorder = vi.fn();
const markRecallDesktopSdkFallback = vi.fn();
const LocalRecorderUploadError = vi.hoisted(() => class LocalRecorderUploadError extends Error {});

vi.mock("@/lib/local-recorder-auth", () => ({
  createLocalRecorderDeviceSession,
  getLocalRecorderDeviceRequestContext,
}));

vi.mock("@/lib/local-recorder-records", () => ({
  claimLocalRecorderIntent,
  completeLocalRecorderRecordingUpload,
  createRecallDesktopSdkUploadForLocalRecorder,
  createManualLocalRecorderIntent,
  failLocalRecorderIntent,
  getLocalRecorderMonitoringStatus,
  listMissedLocalRecorderMeetings,
  markRecallDesktopSdkFallback,
  LocalRecorderUploadError,
  prepareLocalRecorderRecordingUpload,
}));

function mockSignedInDevice() {
  getLocalRecorderDeviceRequestContext.mockResolvedValue({
    appVersion: "0.2.0+abc123",
    ok: true,
    deviceId: "mac_123",
    permissionReadiness: {
      microphone: "granted",
      notifications: "granted",
      screenCapture: "granted",
      startAtLogin: "granted",
    },
    workspace: {
      teamId: "team_123",
      userId: "user_123",
    },
  });
}

describe("local recorder API routes", () => {
  afterEach(() => {
    createLocalRecorderDeviceSession.mockReset();
    getLocalRecorderDeviceRequestContext.mockReset();
    listMissedLocalRecorderMeetings.mockReset();
    createManualLocalRecorderIntent.mockReset();
    getLocalRecorderMonitoringStatus.mockReset();
    claimLocalRecorderIntent.mockReset();
    failLocalRecorderIntent.mockReset();
    completeLocalRecorderRecordingUpload.mockReset();
    prepareLocalRecorderRecordingUpload.mockReset();
    createRecallDesktopSdkUploadForLocalRecorder.mockReset();
    markRecallDesktopSdkFallback.mockReset();
    vi.resetModules();
  });

  it("returns eligible missed meetings for a signed in Mac device", async () => {
    mockSignedInDevice();
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
      appVersion: "0.2.0+abc123",
      deviceId: "mac_123",
      now: expect.any(Date),
      permissionReadiness: {
        microphone: "granted",
        notifications: "granted",
        screenCapture: "granted",
        startAtLogin: "granted",
      },
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("returns monitoring status for a signed in Mac device", async () => {
    mockSignedInDevice();
    getLocalRecorderMonitoringStatus.mockResolvedValue({
      missedMeetings: [],
      nextMeeting: {
        botStatus: "planned",
        botStatusDetail: "Bot is scheduled",
        botStatusLabel: "Planned",
        endsAt: "2026-06-30T13:00:00.000Z",
        meetingId: "meeting_123",
        startsAt: "2026-06-30T12:00:00.000Z",
        title: "Weekly sync",
      },
    });

    const { GET } = await import("@/app/api/local-recorder/monitoring/route");
    const response = await GET(
      new Request("https://app.example.com/api/local-recorder/monitoring", {
        headers: { "x-local-recorder-device-id": "mac_123" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      missedMeetings: [],
      nextMeeting: {
        botStatus: "planned",
        botStatusDetail: "Bot is scheduled",
        botStatusLabel: "Planned",
        endsAt: "2026-06-30T13:00:00.000Z",
        meetingId: "meeting_123",
        startsAt: "2026-06-30T12:00:00.000Z",
        title: "Weekly sync",
      },
    });
    expect(getLocalRecorderMonitoringStatus).toHaveBeenCalledWith({
      appVersion: "0.2.0+abc123",
      deviceId: "mac_123",
      now: expect.any(Date),
      permissionReadiness: {
        microphone: "granted",
        notifications: "granted",
        screenCapture: "granted",
        startAtLogin: "granted",
      },
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("creates a manual recording intent for a signed in Mac device", async () => {
    mockSignedInDevice();
    createManualLocalRecorderIntent.mockResolvedValue({
      fallbackIntentId: "manual_intent_123",
      meetingTitle: "Manual recording",
    });

    const { POST } = await import(
      "@/app/api/local-recorder/manual-intents/route"
    );
    const response = await POST(
      new Request("https://app.example.com/api/local-recorder/manual-intents", {
        method: "POST",
        headers: { "x-local-recorder-device-id": "mac_123" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fallbackIntentId: "manual_intent_123",
      meetingTitle: "Manual recording",
    });
    expect(createManualLocalRecorderIntent).toHaveBeenCalledWith({
      deviceId: "mac_123",
      now: expect.any(Date),
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("claims a fallback intent before recording starts", async () => {
    mockSignedInDevice();
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
          headers: {
            "content-type": "application/json",
            "x-local-recorder-device-id": "mac_123",
          },
          body: JSON.stringify({ explicit: false }),
        },
      ),
      { params: Promise.resolve({ fallbackIntentId: "intent_123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimed: true,
      meetingTitle: "Weekly sync",
    });
    expect(claimLocalRecorderIntent).toHaveBeenCalledWith(
      expect.objectContaining({ explicit: false }),
    );
  });

  it("marks a claimed fallback intent failed when local capture cannot start", async () => {
    mockSignedInDevice();
    failLocalRecorderIntent.mockResolvedValue({
      failed: true,
    });

    const { POST } = await import(
      "@/app/api/local-recorder/intents/[fallbackIntentId]/fail/route"
    );
    const response = await POST(
      new Request(
        "https://app.example.com/api/local-recorder/intents/intent_123/fail",
        {
          method: "POST",
          body: JSON.stringify({ errorMessage: "Screen recording denied" }),
          headers: { "x-local-recorder-device-id": "mac_123" },
        },
      ),
      { params: Promise.resolve({ fallbackIntentId: "intent_123" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ failed: true });
    expect(failLocalRecorderIntent).toHaveBeenCalledWith({
      deviceId: "mac_123",
      errorMessage: "Screen recording denied",
      fallbackIntentId: "intent_123",
      now: expect.any(Date),
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("prepares direct upload URLs for all local recorder audio assets", async () => {
    mockSignedInDevice();
    prepareLocalRecorderRecordingUpload.mockResolvedValue({
      assets: {
        computerAudio: {
          assetId: "asset_computer",
          contentType: "audio/wav",
          uploadUrl: "https://r2.example.com/computer",
        },
        microphoneAudio: {
          assetId: "asset_microphone",
          contentType: "audio/wav",
          uploadUrl: "https://r2.example.com/microphone",
        },
        synthesizedAudio: {
          assetId: "asset_synthesized",
          contentType: "audio/wav",
          uploadUrl: "https://r2.example.com/synthesized",
        },
      },
    });

    const { POST } = await import(
      "@/app/api/local-recorder/recordings/prepare/route"
    );
    const response = await POST(
      new Request("https://app.example.com/api/local-recorder/recordings/prepare", {
        method: "POST",
        body: JSON.stringify({
          fallbackIntentId: "intent_123",
          clientRecordingId: "recording_123",
          recordingStartedAt: "2026-06-30T12:02:00.000Z",
          recordingStoppedAt: "2026-06-30T13:00:00.000Z",
          manifest: { appVersion: "0.1.0" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assets: {
        computerAudio: {
          assetId: "asset_computer",
          contentType: "audio/wav",
          uploadUrl: "https://r2.example.com/computer",
        },
        microphoneAudio: {
          assetId: "asset_microphone",
          contentType: "audio/wav",
          uploadUrl: "https://r2.example.com/microphone",
        },
        synthesizedAudio: {
          assetId: "asset_synthesized",
          contentType: "audio/wav",
          uploadUrl: "https://r2.example.com/synthesized",
        },
      },
    });
    expect(prepareLocalRecorderRecordingUpload).toHaveBeenCalledWith({
      clientRecordingId: "recording_123",
      deviceId: "mac_123",
      fallbackIntentId: "intent_123",
      manifest: { appVersion: "0.1.0" },
      recordingStartedAt: new Date("2026-06-30T12:02:00.000Z"),
      recordingStoppedAt: new Date("2026-06-30T13:00:00.000Z"),
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("creates a Recall Desktop SDK upload for speaker attributed local recording", async () => {
    mockSignedInDevice();
    createRecallDesktopSdkUploadForLocalRecorder.mockResolvedValue({
      fallbackIntentId: "intent_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallApiUrl: "https://us-east-1.recall.ai",
      sdkUploadId: "33333333-3333-4333-8333-333333333333",
      uploadToken: "recall_upload_token_123",
    });

    const { POST } = await import(
      "@/app/api/local-recorder/recordings/sdk-upload/route"
    );
    const response = await POST(
      new Request(
        "https://app.example.com/api/local-recorder/recordings/sdk-upload",
        {
          method: "POST",
          body: JSON.stringify({
            fallbackIntentId: "intent_123",
            clientRecordingId: "recording_123",
          }),
          headers: { "x-local-recorder-device-id": "mac_123" },
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fallbackIntentId: "intent_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallApiUrl: "https://us-east-1.recall.ai",
      sdkUploadId: "33333333-3333-4333-8333-333333333333",
      uploadToken: "recall_upload_token_123",
    });
    expect(createRecallDesktopSdkUploadForLocalRecorder).toHaveBeenCalledWith({
      clientRecordingId: "recording_123",
      deviceId: "mac_123",
      fallbackIntentId: "intent_123",
      requestUrl: "https://app.example.com/api/local-recorder/recordings/sdk-upload",
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("rejects invalid Recall Desktop SDK upload requests", async () => {
    mockSignedInDevice();

    const { POST } = await import(
      "@/app/api/local-recorder/recordings/sdk-upload/route"
    );
    const response = await POST(
      new Request(
        "https://app.example.com/api/local-recorder/recordings/sdk-upload",
        {
          method: "POST",
          body: JSON.stringify({
            clientRecordingId: "recording_123",
          }),
          headers: { "x-local-recorder-device-id": "mac_123" },
        },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Recall Desktop SDK upload request",
    });
    expect(createRecallDesktopSdkUploadForLocalRecorder).not.toHaveBeenCalled();
  });

  it("marks a Recall SDK upload as replaced by local capture", async () => {
    mockSignedInDevice();
    markRecallDesktopSdkFallback.mockResolvedValue({ marked: true });
    const { POST } = await import(
      "@/app/api/local-recorder/recordings/sdk-upload/fallback/route"
    );

    const response = await POST(
      new Request(
        "https://app.example.com/api/local-recorder/recordings/sdk-upload/fallback",
        {
          method: "POST",
          body: JSON.stringify({ fallbackIntentId: "intent_123" }),
          headers: { "x-local-recorder-device-id": "mac_123" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(markRecallDesktopSdkFallback).toHaveBeenCalledWith({
      deviceId: "mac_123",
      fallbackIntentId: "intent_123",
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("rejects an invalid Recall SDK fallback request", async () => {
    mockSignedInDevice();
    const { POST } = await import(
      "@/app/api/local-recorder/recordings/sdk-upload/fallback/route"
    );

    const response = await POST(new Request("https://app.example.com/route", {
      method: "POST",
      body: "null",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Recall Desktop SDK fallback request",
    });
    expect(markRecallDesktopSdkFallback).not.toHaveBeenCalled();
  });

  it("completes a direct local recorder upload and queues processing", async () => {
    mockSignedInDevice();
    completeLocalRecorderRecordingUpload.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      queued: true,
    });

    const { POST } = await import(
      "@/app/api/local-recorder/recordings/complete/route"
    );
    const response = await POST(
      new Request("https://app.example.com/api/local-recorder/recordings/complete", {
        method: "POST",
        body: JSON.stringify({
          fallbackIntentId: "intent_123",
          clientRecordingId: "recording_123",
          recordingStartedAt: "2026-06-30T12:02:00.000Z",
          recordingStoppedAt: "2026-06-30T13:00:00.000Z",
          manifest: { appVersion: "0.1.0" },
          assets: {
            computerAudioAssetId: "asset_computer",
            microphoneAudioAssetId: "asset_microphone",
            synthesizedAudioAssetId: "asset_synthesized",
          },
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      meetingId: "11111111-1111-4111-8111-111111111111",
      queued: true,
    });
    expect(completeLocalRecorderRecordingUpload).toHaveBeenCalledWith({
      assets: {
        computerAudioAssetId: "asset_computer",
        microphoneAudioAssetId: "asset_microphone",
        synthesizedAudioAssetId: "asset_synthesized",
      },
      clientRecordingId: "recording_123",
      deviceId: "mac_123",
      fallbackIntentId: "intent_123",
      manifest: { appVersion: "0.1.0" },
      recordingStartedAt: new Date("2026-06-30T12:02:00.000Z"),
      recordingStoppedAt: new Date("2026-06-30T13:00:00.000Z"),
      workspace: {
        teamId: "team_123",
        userId: "user_123",
      },
    });
  });

  it("returns 400 when direct local recorder upload completion is invalid", async () => {
    mockSignedInDevice();

    const { POST } = await import(
      "@/app/api/local-recorder/recordings/complete/route"
    );
    const response = await POST(
      new Request("https://app.example.com/api/local-recorder/recordings/complete", {
        method: "POST",
        body: JSON.stringify({
          fallbackIntentId: "intent_123",
          clientRecordingId: "recording_123",
          recordingStartedAt: "2026-06-30T12:02:00.000Z",
          recordingStoppedAt: "2026-06-30T13:00:00.000Z",
          assets: {
            computerAudioAssetId: "asset_computer",
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid local recording completion",
    });
    expect(completeLocalRecorderRecordingUpload).not.toHaveBeenCalled();
  });

  it.each([
    [
      "preparation",
      prepareLocalRecorderRecordingUpload,
      () => import("@/app/api/local-recorder/recordings/prepare/route"),
      {
        clientRecordingId: "recording_123",
        fallbackIntentId: "intent_123",
        manifest: {},
        recordingStartedAt: "2026-07-20T12:00:00.000Z",
        recordingStoppedAt: "2026-07-20T12:30:00.000Z",
      },
      "Local recording preparation unavailable",
    ],
    [
      "completion",
      completeLocalRecorderRecordingUpload,
      () => import("@/app/api/local-recorder/recordings/complete/route"),
      {
        assets: {
          computerAudioAssetId: "asset_1",
          microphoneAudioAssetId: "asset_2",
          synthesizedAudioAssetId: "asset_3",
        },
        clientRecordingId: "recording_123",
        fallbackIntentId: "intent_123",
        manifest: {},
        recordingStartedAt: "2026-07-20T12:00:00.000Z",
        recordingStoppedAt: "2026-07-20T12:30:00.000Z",
      },
      "Local recording completion unavailable",
    ],
    [
      "SDK upload",
      createRecallDesktopSdkUploadForLocalRecorder,
      () => import("@/app/api/local-recorder/recordings/sdk-upload/route"),
      {
        clientRecordingId: "recording_123",
        fallbackIntentId: "intent_123",
      },
      "Recall Desktop SDK upload unavailable",
    ],
  ])("maps expected and unexpected %s errors", async (
    _name,
    operation,
    loadRoute,
    body,
    unavailableMessage,
  ) => {
    mockSignedInDevice();
    const { POST } = await loadRoute();
    operation.mockRejectedValueOnce(new LocalRecorderUploadError("Upload conflict"));

    const conflictResponse = await POST(new Request("https://app.example.com/route", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toEqual({ error: "Upload conflict" });

    operation.mockRejectedValueOnce(new Error("vendor unavailable"));
    const failureResponse = await POST(new Request("https://app.example.com/route", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    expect(failureResponse.status).toBe(500);
    await expect(failureResponse.json()).resolves.toEqual({ error: unavailableMessage });
  });

  it("rejects unauthorized and invalid preparation requests", async () => {
    const { POST } = await import(
      "@/app/api/local-recorder/recordings/prepare/route"
    );
    getLocalRecorderDeviceRequestContext.mockResolvedValueOnce({
      ok: false,
      error: "Device authentication required",
      status: 401,
    });
    const unauthorized = await POST(new Request("https://app.example.com/route", {
      method: "POST",
      body: "{}",
    }));
    expect(unauthorized.status).toBe(401);

    mockSignedInDevice();
    const invalid = await POST(new Request("https://app.example.com/route", {
      method: "POST",
      body: "{}",
    }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Invalid local recording preparation",
    });
  });

  it.each([
    ["completion", () => import("@/app/api/local-recorder/recordings/complete/route")],
    ["SDK upload", () => import("@/app/api/local-recorder/recordings/sdk-upload/route")],
    ["SDK fallback", () => import("@/app/api/local-recorder/recordings/sdk-upload/fallback/route")],
  ])("rejects an unauthorized %s request", async (_name, loadRoute) => {
    getLocalRecorderDeviceRequestContext.mockResolvedValue({
      ok: false,
      error: "Device authentication required",
      status: 401,
    });
    const { POST } = await loadRoute();

    const response = await POST(new Request("https://app.example.com/route", {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Device authentication required",
    });
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

  it("redirects unsigned in device login requests through web sign in", async () => {
    createLocalRecorderDeviceSession.mockResolvedValue({
      error: "Unauthorized",
    });

    const { GET } = await import(
      "@/app/api/local-recorder/device-login/route"
    );
    const response = await GET(
      new Request(
        "https://app.example.com/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
      ),
    );

    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://app.example.com");
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
    );
  });

  it("returns a browser sign in bridge for unsigned in device login requests", async () => {
    createLocalRecorderDeviceSession.mockResolvedValue({
      error: "Unauthorized",
    });

    const { GET } = await import(
      "@/app/api/local-recorder/device-login/route"
    );
    const response = await GET(
      new Request(
        "https://app.example.com/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
        {
          headers: { accept: "text/html,application/xhtml+xml" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const body = await response.text();
    expect(body).toContain("Opening sign in");
    expect(body).toContain("Continue to sign in");
    expect(body).toContain(
      "https://app.example.com/auth/sign-in?callbackUrl=%2Fapi%2Flocal-recorder%2Fdevice-login%3FdeviceId%3Dmac_123%26callbackUrl%3Dmeetingnote-local-recorder%253A%252F%252Flogin",
    );
  });

  it("preserves controlled device login error statuses", async () => {
    createLocalRecorderDeviceSession.mockResolvedValue({
      error: "Shared users cannot add meetings",
      status: 403,
    });

    const { GET } = await import(
      "@/app/api/local-recorder/device-login/route"
    );
    const response = await GET(
      new Request(
        "https://app.example.com/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Shared users cannot add meetings",
    });
  });
});
