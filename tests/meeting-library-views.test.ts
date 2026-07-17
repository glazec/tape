import { afterEach, describe, expect, it, vi } from "vitest";

const { insert, limit, onConflictDoUpdate, values } = vi.hoisted(() => ({
  insert: vi.fn(),
  limit: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  },
}));

const workspace = {
  canCreateMeetings: true,
  domain: "example.com",
  teamId: "team_123",
  userId: "user_123",
};

describe("meeting library views", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns null when the user has no saved default", async () => {
    limit.mockResolvedValue([]);
    const { getDefaultMeetingLibraryView } = await import(
      "@/lib/meeting-library-views"
    );

    await expect(getDefaultMeetingLibraryView(workspace)).resolves.toBeNull();
  });

  it("normalizes a saved default view", async () => {
    limit.mockResolvedValue([
      {
        query: " Alice ",
        searchScope: "participants",
        sort: "duration_desc",
        status: "ready",
      },
    ]);
    const { getDefaultMeetingLibraryView } = await import(
      "@/lib/meeting-library-views"
    );

    await expect(getDefaultMeetingLibraryView(workspace)).resolves.toEqual({
      query: "Alice",
      searchScope: "participants",
      sort: "duration_desc",
      status: "ready",
    });
  });

  it("upserts one default view per user and team", async () => {
    values.mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });
    onConflictDoUpdate.mockResolvedValue(undefined);
    const { saveDefaultMeetingLibraryView } = await import(
      "@/lib/meeting-library-views"
    );

    await saveDefaultMeetingLibraryView({
      config: {
        query: "Alice",
        searchScope: "all",
        sort: "smart",
        status: "all",
      },
      workspace,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        isDefault: true,
        name: "My view",
        query: "Alice",
        teamId: "team_123",
        userId: "user_123",
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ query: "Alice" }),
        target: expect.any(Array),
      }),
    );
  });
});
