import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  getWorkspace,
  insert,
  limit,
  onConflictDoUpdate,
  set,
  update,
  values,
  where,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  insert: vi.fn(),
  limit: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select: () => ({
      from: () => ({
        where: () => ({
          limit,
        }),
      }),
    }),
    update,
  },
}));

async function patchSpeakerLabel(body: unknown) {
  const { PATCH } = await import("@/app/api/meetings/[meetingId]/speakers/route");

  return PATCH(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/speakers",
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
      },
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

describe("PATCH /api/meetings/[meetingId]/speakers", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    insert.mockReset();
    limit.mockReset();
    onConflictDoUpdate.mockReset();
    set.mockReset();
    update.mockReset();
    values.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("renames unknown speaker labels for an authenticated workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);

    const response = await patchSpeakerLabel({
      currentSpeaker: null,
      speaker: "Alice",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applyTo: "matching_speaker",
      segmentId: null,
      updated: true,
      speaker: "Alice",
    });
    expect(set).toHaveBeenCalledWith({
      speaker: "Alice",
      updatedAt: expect.any(Date),
    });
  });

  it("can rename only one transcript line for shared microphone corrections", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);

    const response = await patchSpeakerLabel({
      applyTo: "segment",
      currentSpeaker: "Speaker 1",
      segmentId: "22222222-2222-4222-8222-222222222222",
      speaker: "Dan",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applyTo: "segment",
      segmentId: "22222222-2222-4222-8222-222222222222",
      updated: true,
      speaker: "Dan",
    });
    expect(set).toHaveBeenCalledWith({
      speaker: "Dan",
      updatedAt: expect.any(Date),
    });
  });

  it("accepts speaker aliases so one save can merge existing name variants", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);

    const response = await patchSpeakerLabel({
      applyTo: "matching_speaker",
      currentSpeaker: "Speaker 2",
      currentSpeakerAliases: ["TeSt User"],
      speaker: "Test User",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applyTo: "matching_speaker",
      segmentId: null,
      updated: true,
      speaker: "Test User",
    });
    expect(set).toHaveBeenCalledWith({
      speaker: "Test User",
      updatedAt: expect.any(Date),
    });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("stores team speaker aliases so future meetings use the same name", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    insert.mockReturnValue({ values });
    values.mockReturnValue({ onConflictDoUpdate });
    onConflictDoUpdate.mockResolvedValue(undefined);

    const response = await patchSpeakerLabel({
      applyTo: "matching_speaker",
      currentSpeaker: "Saved Alias",
      currentSpeakerAliases: ["Test User"],
      speaker: "Test User",
    });

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "Saved Alias",
          aliasKey: "saved alias",
          canonicalName: "Test User",
          teamId: "team_123",
        }),
        expect.objectContaining({
          alias: "Test User",
          aliasKey: "test user",
          canonicalName: "Test User",
          teamId: "team_123",
        }),
      ]),
    );
  });

  it("rejects segment scoped updates without a segment id", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await patchSpeakerLabel({
      applyTo: "segment",
      currentSpeaker: "Speaker 1",
      speaker: "Dan",
    });

    expect(response.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects blank replacement labels", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await patchSpeakerLabel({
      currentSpeaker: null,
      speaker: " ",
    });

    expect(response.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
});
