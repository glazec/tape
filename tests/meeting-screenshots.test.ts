import { afterEach, describe, expect, it, vi } from "vitest";

const { insert, listRecallBotScreenshots, putObject, select } = vi.hoisted(
  () => ({
    insert: vi.fn(),
    listRecallBotScreenshots: vi.fn(),
    putObject: vi.fn(),
    select: vi.fn(),
  }),
);

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
  },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    putObject,
  };
});

vi.mock("@/lib/vendors/recall", () => ({
  listRecallBotScreenshots,
}));

describe("persistRecallBotScreenshots", () => {
  afterEach(() => {
    insert.mockReset();
    listRecallBotScreenshots.mockReset();
    putObject.mockReset();
    select.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("stores Recall screenshots as timestamped meeting assets", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "access");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "recordings");
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              teamId: "team_123",
              startedAt: new Date("2026-06-29T14:00:00.000Z"),
            },
          ]),
        }),
      }),
    });
    listRecallBotScreenshots.mockResolvedValue([
      {
        id: "screenshot_123",
        capturedAt: "2026-06-29T14:01:05.000Z",
        downloadUrl: "https://recall.example.com/screenshot.jpg",
      },
      {
        id: "screenshot_123",
        capturedAt: "2026-06-29T14:01:05.000Z",
        downloadUrl: "https://recall.example.com/screenshot.jpg?signature=2",
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })),
      ),
    );
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });
    const { persistRecallBotScreenshots } = await import(
      "@/lib/meeting-screenshots"
    );

    await expect(
      persistRecallBotScreenshots({
        botId: "bot_123",
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({ count: 1 });

    expect(putObject).toHaveBeenCalledWith({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      key: expect.stringMatching(
        /^teams\/team_123\/meetings\/11111111-1111-4111-8111-111111111111\/assets\/recall-[a-f0-9]{16}\.jpg$/,
      ),
    });
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "recordings",
        capturedAt: new Date("2026-06-29T14:01:05.000Z"),
        fileSizeBytes: 3,
        meetingId: "11111111-1111-4111-8111-111111111111",
        mimeType: "image/jpeg",
        source: "recall",
        timestampMs: 65000,
        type: "screenshot",
      }),
    );
  });
});
