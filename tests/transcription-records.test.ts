import { afterEach, describe, expect, it, vi } from "vitest";

const getOrCreateWorkspaceForSessionUser = vi.fn();
const assertCanCreateMeetings = vi.fn();
const importUploadedRecording = vi.fn();
const insert = vi.fn();
const select = vi.fn();
const databaseSql = Object.assign(vi.fn(), { transaction: vi.fn(), query: vi.fn() });
const update = vi.fn();
const reconcileMeetingSharingForMeeting = vi.fn();

vi.mock("@/db/client", () => ({
  databaseSql,
  db: {
    insert,
    select,
    update,
  },
}));

vi.mock("@/lib/r2", () => ({
  buildMeetingObjectKey: ({
    assetId,
    meetingId,
    teamId,
    extension,
  }: {
    assetId: string;
    meetingId: string;
    teamId: string;
    extension: string;
  }) => `teams/${teamId}/meetings/${meetingId}/assets/${assetId}.${extension}`,
  getObjectMetadata: vi.fn(),
  parseR2Env: () => ({ R2_BUCKET: "meeting-audio" }),
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));

vi.mock("@/lib/meeting-share-rules", () => ({
  reconcileMeetingSharingForMeeting,
}));

vi.mock("@/lib/provider-usage", () => ({
  recordRecallRecordingUsage: vi.fn(),
}));

vi.mock("@/lib/upload-recording-import", () => ({ importUploadedRecording }));

describe("createRecallRecordingTranscription", () => {
  afterEach(() => {
    databaseSql.mockReset(); databaseSql.transaction.mockReset(); databaseSql.query.mockReset();
    vi.resetModules();
  });
  it.each([true, false])("atomically inserts or reuses capture and job, rebases, and returns queue state %s", async (shouldQueue) => {
    databaseSql.mockResolvedValue([{ transcript_job_id: "job", recording_id: "recording", should_queue: shouldQueue }]);
    databaseSql.transaction.mockImplementation(async (build) => Promise.all(build(databaseSql)));
    const { createRecallRecordingTranscription } = await import("@/lib/transcription-records");
    await expect(createRecallRecordingTranscription({ externalRecordingId: "external", meetingId: "meeting", mode: "append" })).resolves.toEqual({ meetingId: "meeting", recordingId: "recording", transcriptJobId: "job", shouldQueue });
    expect(databaseSql.mock.calls[0][0].join(" ")).toContain("pg_advisory_xact_lock");
    expect(databaseSql.mock.calls[1][0].join(" ")).toContain("then 'append' else 'replace'");
    expect(databaseSql.mock.calls[1][0].join(" ")).toContain("provider_job_id is null");
    expect(databaseSql.query.mock.calls[0][0]).toContain("recording_offset_ms");
  });
  it("rejects an external recording already owned by another meeting", async () => {
    databaseSql.mockResolvedValue([]);
    databaseSql.transaction.mockImplementation(async (build) => Promise.all(build(databaseSql)));
    const { createRecallRecordingTranscription } = await import("@/lib/transcription-records");
    await expect(createRecallRecordingTranscription({ externalRecordingId: "external", meetingId: "other" })).rejects.toThrow("could not be created");
    expect(databaseSql.mock.calls[1][0].join(" ")).toContain("where recordings.meeting_id = excluded.meeting_id");
  });
});

describe("uploaded transcription records", () => {
  afterEach(() => { vi.clearAllMocks(); vi.resetModules(); });
  it.each(["audio", "video"])("uses the atomic import for %s and preserves the chosen destination", async (kind) => {
    const workspace = { userId: "user", teamId: "team" };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    importUploadedRecording.mockResolvedValue({ meetingId: "meeting", mediaAssetId: "asset", recordingId: "recording", transcriptJobId: "job" });
    const input = {
      sessionUser: { id: "user", email: "user@example.com", name: null },
      meetingId: "meeting", objectKey: "object", title: "Title",
      startedAt: new Date("2026-10-19T15:41:00Z"), durationMs: 5000,
    };
    const { createUploadedAudioTranscription, createUploadedVideoTranscription } = await import("@/lib/transcription-records");
    const result = await (kind === "audio" ? createUploadedAudioTranscription(input) : createUploadedVideoTranscription(input));
    expect(importUploadedRecording).toHaveBeenCalledWith({ ...input, workspace, kind });
    expect(result).toMatchObject({ meetingId: "meeting", recordingId: "recording", transcriptJobId: "job" });
    if (kind === "video") expect(result).toMatchObject({ sourceMediaAssetId: "asset", audioMediaAssetId: "job", audioObjectKey: "teams/team/meetings/meeting/assets/job.mp3" });
    expect(insert).not.toHaveBeenCalled();
  });
});
