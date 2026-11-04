import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), authorize: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/local-recorder-auth", () => ({ getLocalRecorderDeviceRequestContext: mocks.auth }));
vi.mock("@/lib/local-recorder-records", () => ({ authorizeLocalRecorderMultipartUpload: mocks.authorize, LocalRecorderUploadError: class extends Error {} }));
vi.mock("@/lib/local-recorder-multipart", async original => ({ ...await original<typeof import("@/lib/local-recorder-multipart")>(), recorderMultipartUpload: mocks.upload }));
vi.mock("@/lib/provider-credit", () => ({ assertWorkspaceHasProviderCredit: vi.fn(), providerCreditErrorResponse: () => null }));
vi.mock("@/lib/request-rate-limit", () => ({ assertRequestRateLimit: vi.fn(), requestRateLimitErrorResponse: () => null, requestRateLimitPolicies: { localRecorderProviderUpload: {} } }));
import { POST } from "@/app/api/local-recorder/recordings/multipart/route";
const body = { action: "status", role: "computerAudio", clientRecordingId: "recording", fallbackIntentId: "intent", recordingStartedAt: "2026-11-03T12:00:00Z", fileSize: 100, uploadId: "session" };
const request = (value = body) => new Request("https://app.example.com/api/local-recorder/recordings/multipart", { method: "POST", body: JSON.stringify(value) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, deviceId: "device", workspace: { teamId: "team", userId: "owner" } });
  mocks.authorize.mockResolvedValue({ id: "attempt", meetingId: "meeting" });
  mocks.upload.mockResolvedValue({ completedParts: [1] });
});
it("requires an authenticated paired device", async () => {
  mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("authorizes every resume against the owner and device and derives the destination server side", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "device", workspace: { teamId: "team", userId: "owner" }, fallbackIntentId: "intent" }));
  expect(mocks.upload).toHaveBeenCalledWith(body, { attemptId: "attempt", meetingId: "meeting", teamId: "team" });
});
it("does not issue storage URLs when intent authorization fails", async () => {
  mocks.authorize.mockRejectedValue(new Error("wrong device"));
  expect((await POST(request())).status).toBe(503);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("rejects caller supplied destination keys", async () => {
  expect((await POST(request({ ...body, key: "other-recording" } as typeof body))).status).toBe(400);
  expect(mocks.upload).not.toHaveBeenCalled();
});
