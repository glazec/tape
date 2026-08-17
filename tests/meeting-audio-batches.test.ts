import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanManageMeeting,
  databaseTransaction,
  reconcileMeetingSharingForMeeting,
  select,
  txn,
} = vi.hoisted(() => ({
  assertCanManageMeeting: vi.fn(),
  databaseTransaction: vi.fn(),
  reconcileMeetingSharingForMeeting: vi.fn(),
  select: vi.fn(),
  txn: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction: databaseTransaction },
  db: {
    delete: vi.fn(),
    select,
  },
}));
vi.mock("@/lib/meeting-recovery-uploads", () => ({
  assertCanManageMeeting,
}));
vi.mock("@/lib/meeting-share-rules", () => ({
  reconcileMeetingSharingForMeeting,
}));
vi.mock("@/lib/r2", () => ({
  parseR2Env: () => ({ R2_BUCKET: "meeting-audio" }),
}));

const workspace = {
  domain: "example.com",
  teamId: "33333333-3333-4333-8333-333333333333",
  userId: "44444444-4444-4444-8444-444444444444",
};
const files = [
  {
    durationMs: 60_000,
    fileName: "first.mp3",
    fileSizeBytes: 100,
    mimeType: "audio/mpeg",
    objectKey: "users/user/uploads/first.mp3",
  },
  {
    durationMs: 90_000,
    fileName: "second.m4a",
    fileSizeBytes: 200,
    mimeType: "audio/mp4",
    objectKey: "users/user/uploads/second.m4a",
  },
];

describe("meeting audio batches", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers a new ordered batch atomically before dispatch", async () => {
    mockExistingRows([]);
    databaseTransaction.mockImplementation(async (build) => build(txn));
    reconcileMeetingSharingForMeeting.mockResolvedValue(undefined);
    const { createUploadedAudioBatch } =
      await import("@/lib/meeting-audio-batches");

    const result = await createUploadedAudioBatch({
      files,
      startedAt: new Date("2026-08-16T14:00:00.000Z"),
      title: "first",
      workspace,
    });

    expect(result.transcriptions).toHaveLength(2);
    expect(result.existing).toBe(false);
    expect(databaseTransaction).toHaveBeenCalledOnce();
    expect(txn).toHaveBeenCalledTimes(7);
    expect(txn.mock.calls[3]?.slice(1)).toContain("replace");
    expect(txn.mock.calls[6]?.slice(1)).toContain("append");
    expect(
      txn.mock.calls[4]
        ?.slice(1)
        .some(
          (value) =>
            value instanceof Date &&
            value.toISOString() === "2026-08-16T14:01:00.000Z",
        ),
    ).toBe(true);
    expect(reconcileMeetingSharingForMeeting).toHaveBeenCalledWith(
      result.meetingId,
    );
  });

  it("creates a single uploaded meeting without a supplied duration", async () => {
    mockExistingRows([]);
    databaseTransaction.mockImplementation(async (build) => build(txn));
    reconcileMeetingSharingForMeeting.mockResolvedValue(undefined);
    const { createUploadedAudioBatch } =
      await import("@/lib/meeting-audio-batches");

    const result = await createUploadedAudioBatch({
      files: [{ ...files[0]!, durationMs: undefined }],
      startedAt: new Date("2026-08-16T14:00:00.000Z"),
      title: "first",
      workspace,
    });

    expect(result.existing).toBe(false);
    expect(txn).toHaveBeenCalledTimes(4);
    expect(txn.mock.calls[1]?.slice(1)).toContain(null);
  });

  it("returns the completed batch after a concurrent insert wins", async () => {
    const existing = {
      mediaAssetId: "asset_1",
      meetingId: "11111111-1111-4111-8111-111111111111",
      objectKey: files[0]!.objectKey,
      recordingId: "recording_1",
      transcriptJobId: "job_1",
    };
    mockExistingRowsSequence([], [existing]);
    databaseTransaction.mockRejectedValue({ code: "23505" });
    assertCanManageMeeting.mockResolvedValue(undefined);
    const { createUploadedAudioBatch } =
      await import("@/lib/meeting-audio-batches");

    const result = await createUploadedAudioBatch({
      files: [files[0]!],
      startedAt: new Date("2026-08-16T14:00:00.000Z"),
      title: "first",
      workspace,
    });

    expect(result).toEqual({
      existing: true,
      meetingId: existing.meetingId,
      transcriptions: [existing],
    });
    expect(assertCanManageMeeting).toHaveBeenCalledWith(
      workspace,
      existing.meetingId,
    );
    expect(reconcileMeetingSharingForMeeting).not.toHaveBeenCalled();
  });

  it("requires durations when a batch contains multiple files", async () => {
    mockExistingRows([]);
    const { createUploadedAudioBatch } =
      await import("@/lib/meeting-audio-batches");

    await expect(
      createUploadedAudioBatch({
        files: [{ ...files[0]!, durationMs: undefined }, files[1]!],
        startedAt: new Date("2026-08-16T14:00:00.000Z"),
        title: "first",
        workspace,
      }),
    ).rejects.toThrow("Every file in a multi audio batch requires a duration");
    expect(databaseTransaction).not.toHaveBeenCalled();
  });

  it("attaches files as one replacement generation", async () => {
    mockExistingRows([]);
    assertCanManageMeeting.mockResolvedValue(undefined);
    databaseTransaction.mockImplementation(async (build) => build(txn));
    const { attachUploadedAudioBatch } =
      await import("@/lib/meeting-audio-batches");

    const result = await attachUploadedAudioBatch({
      files,
      meetingId: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-08-16T14:00:00.000Z"),
      workspace,
    });

    expect(result.transcriptions).toHaveLength(2);
    expect(txn).toHaveBeenCalledTimes(8);
    expect(txn.mock.calls[0]?.[0].join(" ")).toContain("delete from");
    expect(txn.mock.calls[3]?.slice(1)).toContain("replace");
    expect(txn.mock.calls[6]?.slice(1)).toContain("append");
    const firstJobDate = txn.mock.calls[3]
      ?.slice(1)
      .find((value) => value instanceof Date) as Date;
    const secondJobDate = txn.mock.calls[6]
      ?.slice(1)
      .find((value) => value instanceof Date) as Date;
    expect(secondJobDate.getTime()).toBe(firstJobDate.getTime() + 1);
    expect(txn.mock.calls[3]?.[5]).toBe(txn.mock.calls[6]?.[5]);
  });

  it("returns an existing complete batch in requested playback order", async () => {
    mockExistingRows([
      {
        mediaAssetId: "asset_2",
        meetingId: "11111111-1111-4111-8111-111111111111",
        objectKey: files[1]!.objectKey,
        recordingId: "recording_2",
        transcriptJobId: "job_2",
      },
      {
        mediaAssetId: "asset_1",
        meetingId: "11111111-1111-4111-8111-111111111111",
        objectKey: files[0]!.objectKey,
        recordingId: "recording_1",
        transcriptJobId: "job_1",
      },
    ]);
    assertCanManageMeeting.mockResolvedValue(undefined);
    const { attachUploadedAudioBatch } =
      await import("@/lib/meeting-audio-batches");

    const result = await attachUploadedAudioBatch({
      files,
      meetingId: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date(),
      workspace,
    });

    expect(result.transcriptions.map((item) => item.objectKey)).toEqual(
      files.map((file) => file.objectKey),
    );
    expect(databaseTransaction).not.toHaveBeenCalled();
  });
});

function mockExistingRows(rows: unknown[]) {
  select.mockReturnValue({
    from: () => ({
      innerJoin: () => ({ where: vi.fn().mockResolvedValue(rows) }),
    }),
  });
}

function mockExistingRowsSequence(...rows: unknown[][]) {
  const where = vi.fn();
  rows.forEach((result) => where.mockResolvedValueOnce(result));
  select.mockReturnValue({
    from: () => ({ innerJoin: () => ({ where }) }),
  });
}
