import { afterEach, describe, expect, it, vi } from "vitest";

const { insert, select } = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert, select },
}));

describe("meeting bot profile", () => {
  afterEach(() => {
    insert.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("returns the saved team bot profile", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              botName: "Deal Scribe",
              avatarJpegBase64: "custom-avatar",
            },
          ]),
        }),
      }),
    });

    const { getMeetingBotProfile } = await import("@/lib/meeting-bot-profile");

    await expect(getMeetingBotProfile("team_123")).resolves.toEqual({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
    });
  });

  it("normalizes and stores a JPG avatar for the team", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });

    const { upsertMeetingBotProfile } = await import(
      "@/lib/meeting-bot-profile"
    );

    await upsertMeetingBotProfile({
      teamId: "team_123",
      botName: " Deal   Scribe ",
      avatarFile: new File([new Uint8Array([1, 2, 3])], "avatar.jpg", {
        type: "image/jpeg",
      }),
    });

    expect(values).toHaveBeenCalledWith({
      teamId: "team_123",
      botName: "Deal Scribe",
      avatarJpegBase64: "AQID",
    });
  });

  it("rejects non JPG avatar files", async () => {
    const { upsertMeetingBotProfile } = await import(
      "@/lib/meeting-bot-profile"
    );

    await expect(
      upsertMeetingBotProfile({
        teamId: "team_123",
        botName: "Deal Scribe",
        avatarFile: new File(["not a jpg"], "avatar.png", {
          type: "image/png",
        }),
      }),
    ).rejects.toThrow("Bot avatar must be a JPG image");
  });

  it("builds Recall profile payloads without redundant defaults", async () => {
    const {
      getMeetingBotMetadata,
      getMeetingBotRecallCreateInput,
      getMeetingBotRecallUpdateInput,
    } = await import("@/lib/meeting-bot-profile");

    const customProfile = {
      avatarJpegBase64: "custom-avatar",
      botName: "Deal Scribe",
    };
    expect(getMeetingBotRecallCreateInput(customProfile)).toEqual({
      avatarJpegBase64: "custom-avatar",
      botName: "Deal Scribe",
    });
    expect(getMeetingBotRecallUpdateInput(customProfile)).toEqual({
      avatarJpegBase64: "custom-avatar",
      botName: "Deal Scribe",
    });
    expect(getMeetingBotMetadata(customProfile)).toEqual({
      botName: "Deal Scribe",
    });
    expect(getMeetingBotRecallUpdateInput({
      avatarJpegBase64: null,
      botName: "IOSG Old Friend",
    })).toEqual({});
  });

  it("rejects missing and oversized bot names", async () => {
    const { upsertMeetingBotProfile } = await import(
      "@/lib/meeting-bot-profile"
    );

    await expect(upsertMeetingBotProfile({
      teamId: "team_123",
      botName: "   ",
    })).rejects.toThrow("Bot name is required");
    await expect(upsertMeetingBotProfile({
      teamId: "team_123",
      botName: "x".repeat(101),
    })).rejects.toThrow("Bot name must be 100 characters or fewer");
  });

  it("rejects avatars larger than one megabyte", async () => {
    const { upsertMeetingBotProfile } = await import(
      "@/lib/meeting-bot-profile"
    );

    await expect(upsertMeetingBotProfile({
      teamId: "team_123",
      botName: "Deal Scribe",
      avatarFile: new File(
        [new Uint8Array(1_000_001)],
        "avatar.jpg",
        { type: "image/jpeg" },
      ),
    })).rejects.toThrow("Bot avatar must be smaller than 1 MB");
  });

  it("clears a saved avatar when reset is requested", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });
    const { upsertMeetingBotProfile } = await import(
      "@/lib/meeting-bot-profile"
    );

    await upsertMeetingBotProfile({
      teamId: "team_123",
      botName: "Deal Scribe",
      resetAvatar: true,
    });

    expect(values).toHaveBeenCalledWith({
      avatarJpegBase64: null,
      botName: "Deal Scribe",
      teamId: "team_123",
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({ avatarJpegBase64: null }),
    }));
  });
});
