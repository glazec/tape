import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { select, send, where } = vi.hoisted(() => ({
  select: vi.fn(),
  send: vi.fn(),
  where: vi.fn(),
}));

const dialect = new PgDialect();

vi.mock("@/db/client", () => ({
  db: { select },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send },
}));

function mockQueuedJobs(rows: unknown[]) {
  where.mockImplementation((condition: SQL) => {
    void condition;
    return {
      orderBy: () => ({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    };
  });
  select.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        leftJoin: () => ({
          where,
        }),
      }),
    }),
  });
}

describe("queued upload transcription dispatch", () => {
  afterEach(() => {
    select.mockReset();
    send.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("reconstructs audio and video events with stable ids", async () => {
    mockQueuedJobs([
      {
        meetingId: "11111111-1111-4111-8111-111111111111",
        mediaAssetId: "22222222-2222-4222-8222-222222222222",
        recordingId: "33333333-3333-4333-8333-333333333333",
        sourceMediaAssetId: "22222222-2222-4222-8222-222222222222",
        sourceObjectKey: "users/user_1/uploads/audio.mp3",
        sourceType: "audio",
        teamId: "44444444-4444-4444-8444-444444444444",
        transcriptJobId: "55555555-5555-4555-8555-555555555555",
      },
      {
        meetingId: "66666666-6666-4666-8666-666666666666",
        mediaAssetId: null,
        recordingId: "77777777-7777-4777-8777-777777777777",
        sourceMediaAssetId: "88888888-8888-4888-8888-888888888888",
        sourceObjectKey: "users/user_1/uploads/video.mp4",
        sourceType: "transcript_source",
        teamId: "99999999-9999-4999-8999-999999999999",
        transcriptJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ]);
    send.mockResolvedValue({ ids: ["event_1"] });
    const { dispatchQueuedUploadTranscriptions } = await import(
      "@/lib/upload-transcription-dispatch"
    );

    await expect(
      dispatchQueuedUploadTranscriptions({
        now: new Date("2026-07-29T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      dispatchedCount: 2,
      failedCount: 0,
      skippedCount: 0,
    });
    const selection = dialect.sqlToQuery(where.mock.calls[0][0]);

    expect(selection.sql).toContain('"meetings"."platform" =');
    expect(selection.sql).toContain(
      '"transcript_jobs"."media_asset_id" is not null',
    );
    expect(selection.params).toContain("upload");
    expect(send).toHaveBeenNthCalledWith(1, {
      id: "upload-transcription:55555555-5555-4555-8555-555555555555",
      name: "meeting/transcribe.audio",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        mediaAssetId: "22222222-2222-4222-8222-222222222222",
        objectKey: "users/user_1/uploads/audio.mp3",
        recordingId: "33333333-3333-4333-8333-333333333333",
        transcriptJobId: "55555555-5555-4555-8555-555555555555",
      },
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      id: "upload-video-conversion:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "meeting/convert.video-to-audio",
      data: {
        audioMediaAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        audioObjectKey:
          "teams/99999999-9999-4999-8999-999999999999/meetings/66666666-6666-4666-8666-666666666666/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3",
        meetingId: "66666666-6666-4666-8666-666666666666",
        recordingId: "77777777-7777-4777-8777-777777777777",
        sourceMediaAssetId: "88888888-8888-4888-8888-888888888888",
        sourceObjectKey: "users/user_1/uploads/video.mp4",
        transcriptJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
  });

  it("leaves failed dispatches eligible for the next sweep", async () => {
    mockQueuedJobs([
      {
        meetingId: "11111111-1111-4111-8111-111111111111",
        mediaAssetId: "22222222-2222-4222-8222-222222222222",
        recordingId: null,
        sourceMediaAssetId: "22222222-2222-4222-8222-222222222222",
        sourceObjectKey: "users/user_1/uploads/audio.mp3",
        sourceType: "audio",
        teamId: "44444444-4444-4444-8444-444444444444",
        transcriptJobId: "55555555-5555-4555-8555-555555555555",
      },
    ]);
    send.mockRejectedValue(new Error("Inngest unavailable"));
    const { dispatchQueuedUploadTranscriptions } = await import(
      "@/lib/upload-transcription-dispatch"
    );

    await expect(dispatchQueuedUploadTranscriptions()).resolves.toEqual({
      dispatchedCount: 0,
      failedCount: 1,
      skippedCount: 0,
    });
  });
});
