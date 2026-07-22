import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { orderBy } = vi.hoisted(() => ({ orderBy: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            leftJoin: () => ({
              where: () => ({ orderBy }),
            }),
          }),
        }),
      }),
    }),
  },
}));

describe("share links", () => {
  afterEach(() => {
    orderBy.mockReset();
    vi.resetModules();
  });

  it("hashes tokens before database lookup", async () => {
    const { hashShareToken } = await import("@/lib/share-links");

    expect(hashShareToken("secret-token")).toBe(
      createHash("sha256").update("secret-token").digest("hex"),
    );
  });

  it("returns null for an invalid or expired token", async () => {
    orderBy.mockResolvedValue([]);
    const { getSharedTranscriptByToken } = await import("@/lib/share-links");

    await expect(getSharedTranscriptByToken("missing")).resolves.toBeNull();
  });

  it("returns only transcript rows with segments", async () => {
    orderBy.mockResolvedValue([
      {
        title: "Weekly review",
        startedAt: new Date("2026-07-20T09:30:00.000Z"),
        recordedStartedAt: new Date("2026-07-20T09:35:00.000Z"),
        sharedByEmail: "alice@example.com",
        sharedByName: "Alice",
        segmentId: "segment_1",
        speaker: "Alice",
        startMs: 100,
        endMs: 200,
        text: "Hello",
        polishedText: "Hello.",
      },
      {
        title: "Weekly review",
        startedAt: new Date("2026-07-20T09:30:00.000Z"),
        recordedStartedAt: new Date("2026-07-20T09:35:00.000Z"),
        sharedByEmail: "alice@example.com",
        sharedByName: "Alice",
        segmentId: null,
        speaker: null,
        startMs: null,
        endMs: null,
        text: null,
        polishedText: null,
      },
    ]);
    const { getSharedTranscriptByToken } = await import("@/lib/share-links");

    await expect(getSharedTranscriptByToken("valid")).resolves.toEqual({
      sharedBy: "Alice",
      startedAt: "2026-07-20T09:35:00.000Z",
      title: "Weekly review",
      segments: [
        {
          id: "segment_1",
          speaker: "Alice",
          startMs: 100,
          endMs: 200,
          text: "Hello",
          polishedText: "Hello.",
        },
      ],
    });
  });
});
