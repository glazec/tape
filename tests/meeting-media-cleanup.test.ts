import { afterEach, describe, expect, it, vi } from "vitest";

const { deleteObject, select, where } = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

vi.mock("@/lib/r2", () => ({
  deleteObject,
  parseR2Env: vi.fn(() => ({ R2_BUCKET: "meeting-audio" })),
}));

describe("meeting media cleanup", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("deletes every stored R2 object before the meeting row is removed", async () => {
    select.mockReturnValue({
      from: () => ({ where }),
    });
    where.mockResolvedValue([
      { objectKey: "meetings/one/audio.mp3" },
      { objectKey: "meetings/one/frame.jpg" },
    ]);
    deleteObject.mockResolvedValue(undefined);
    const { deleteMeetingMediaObjects } = await import(
      "@/lib/meeting-media-cleanup"
    );

    await expect(deleteMeetingMediaObjects("meeting_123")).resolves.toEqual({
      deletedObjectCount: 2,
    });
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith({
      key: "meetings/one/audio.mp3",
    });
    expect(deleteObject).toHaveBeenCalledWith({
      key: "meetings/one/frame.jpg",
    });
  });
});
