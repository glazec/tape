import { describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  assertRequestRateLimit,
  assertWorkspaceHasProviderCredit,
  formData,
  getCurrentUser,
  getWorkspace,
  stageAudioBatchFormData,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertWorkspaceHasProviderCredit: vi.fn(),
  formData: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  stageAudioBatchFormData: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));
vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse: () => null,
}));
vi.mock("@/lib/request-rate-limit", () => ({
  assertRequestRateLimit,
  requestRateLimitErrorResponse: () => null,
  requestRateLimitPolicies: {
    serverMediaBatchStage: {
      limit: 10,
      scope: "server_media_batch_stage",
      windowMs: 3_600_000,
    },
  },
}));
vi.mock("@/lib/audio-batch-staging", () => ({
  AudioBatchStagingError: class AudioBatchStagingError extends Error {},
  stageAudioBatchFormData,
}));
vi.mock("@/lib/meeting-recovery-uploads", () => ({
  MeetingRecoveryUploadError: class MeetingRecoveryUploadError extends Error {},
}));

describe("audio batch stage route", () => {
  it("rejects an oversized body before parsing multipart data", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue({
      teamId: "team_1",
      userId: "user_1",
    });
    const { POST } = await import("@/app/api/uploads/audio/batch/route");

    const response = await POST({
      formData,
      headers: new Headers({ "content-length": "1001000001" }),
    } as unknown as Request);

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(stageAudioBatchFormData).not.toHaveBeenCalled();
  });
});
