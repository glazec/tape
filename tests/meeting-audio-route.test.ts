import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createReadUrl,
  findRecallRecordingMediaUrl,
  getCurrentUser,
  getWorkspace,
  limit,
  retrieveRecallBot,
  retrieveRecallRecording,
  where,
} = vi.hoisted(() => ({
  createReadUrl: vi.fn(),
  findRecallRecordingMediaUrl: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  limit: vi.fn(),
  retrieveRecallBot: vi.fn(),
  retrieveRecallRecording: vi.fn(),
  where: vi.fn(),
}));

where.mockImplementation(() => ({
  orderBy: () => ({
    limit,
  }),
}));

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/r2", () => ({
  createReadUrl,
}));

vi.mock("@/lib/vendors/recall", () => ({
  findRecallRecordingMediaUrl,
  retrieveRecallBot,
  retrieveRecallRecording,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          leftJoin: () => ({
            where,
          }),
        }),
        leftJoin: () => ({
          where,
        }),
      }),
    }),
  },
}));

async function getMeetingAudio(
  url = "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio",
  headers?: HeadersInit,
) {
  const { GET } = await import("@/app/api/meetings/[meetingId]/audio/route");

  return GET(new Request(url, { headers }), {
    params: Promise.resolve({
      meetingId: "11111111-1111-4111-8111-111111111111",
    }),
  });
}

describe("GET /api/meetings/[meetingId]/audio", () => {
  afterEach(() => {
    createReadUrl.mockReset();
    findRecallRecordingMediaUrl.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    retrieveRecallBot.mockReset();
    retrieveRecallRecording.mockReset();
    where.mockReset();
    where.mockImplementation(() => ({
      orderBy: () => ({
        limit,
      }),
    }));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await getMeetingAudio();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it("redirects authenticated workspace users to a signed audio URL", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      { objectKey: "users/user_123/uploads/audio.mp3" },
    ]);
    createReadUrl.mockResolvedValue("https://r2.example.com/audio.mp3");

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://r2.example.com/audio.mp3",
    );
    expect(createReadUrl).toHaveBeenCalledWith({
      key: "users/user_123/uploads/audio.mp3",
    });
    expect(retrieveRecallBot).not.toHaveBeenCalled();
  });

  it("prefers synthesized local recorder audio over raw audio assets", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: "teams/team_123/meetings/meeting_123/assets/synthesized.wav",
      },
    ]);
    createReadUrl.mockResolvedValue("https://r2.example.com/synthesized.wav");

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://r2.example.com/synthesized.wav",
    );
    expect(createReadUrl).toHaveBeenCalledWith({
      key: "teams/team_123/meetings/meeting_123/assets/synthesized.wav",
    });
  });

  it("uses explicit share access for shared only users", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "guest_team_123",
      userId: "user_123",
      domain: "partner.com",
      canCreateMeetings: false,
    });
    limit.mockResolvedValue([]);

    const response = await getMeetingAudio();

    expect(response.status).toBe(404);
    const query = toQuery(where.mock.calls[0][0] as SQL);
    expect(query.sql).not.toContain('"meetings"."team_id" =');
    expect(query.sql).toContain('"meeting_access"');
    expect(query.params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "user_123",
      "user_123",
      "admin",
      "owner",
      "user_123",
    ]);
  });

  it("proxies authenticated R2 audio when waveform decoding requests same-origin media", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      { objectKey: "users/user_123/uploads/audio.mp3" },
    ]);
    createReadUrl.mockResolvedValue("https://r2.example.com/audio.mp3");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("fake mp3", {
        headers: { "content-type": "audio/mpeg" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getMeetingAudio(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?proxy=1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("location")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("https://r2.example.com/audio.mp3", expect.objectContaining({ cache: "no-store" }));
    await expect(response.text()).resolves.toBe("fake mp3");
  });

  it.each(["r2", "recall"])("preserves seek ranges and refreshes %s URLs for each request", async (source) => {
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com" });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([source === "r2"
      ? { objectKey: "audio.mp3" }
      : { recallRecordingId: "recording_123" }]);
    retrieveRecallRecording.mockResolvedValue({ id: "recording_123" });
    const resolveUrl = source === "r2" ? createReadUrl : findRecallRecordingMediaUrl;
    resolveUrl.mockReturnValueOnce("https://media.example.com/first")
      .mockReturnValueOnce("https://media.example.com/refreshed");
    const fetchMock = vi.fn().mockImplementation(() => new Response("part", {
      status: 206,
      headers: {
        "content-type": "audio/mpeg",
        "accept-ranges": "bytes",
        "content-range": "bytes 100-103/10000",
        "content-length": "4",
        "etag": '"recording-v1"',
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["first", "refreshed"]) {
      const response = await getMeetingAudio(
        "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?proxy=1",
        { Range: "bytes=100-103", "If-Range": '"recording-v1"' },
      );
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 100-103/10000");
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-length")).toBe("4");
      expect(response.headers.get("etag")).toBe('"recording-v1"');
      expect(fetchMock).toHaveBeenLastCalledWith(`https://media.example.com/${url}`, expect.objectContaining({
        headers: expect.any(Headers),
      }));
      const forwarded = fetchMock.mock.calls.at(-1)?.[1].headers as Headers;
      expect(forwarded.get("range")).toBe("bytes=100-103");
      expect(forwarded.get("if-range")).toBe('"recording-v1"');
      await expect(response.text()).resolves.toBe("part");
    }
  });

  it("preserves unsatisfiable range responses", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com" });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ objectKey: "audio.mp3" }]);
    createReadUrl.mockResolvedValue("https://media.example.com/audio.mp3");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 416, headers: { "content-range": "bytes */10000" },
    })));
    const response = await getMeetingAudio(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?proxy=1",
      { Range: "bytes=20000-" },
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10000");
  });

  it("streams authenticated R2 audio as an attachment when download is requested", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: "users/user_123/uploads/audio.mp3",
        title: "Nascent Sync",
      },
    ]);
    createReadUrl.mockResolvedValue("https://r2.example.com/audio.mp3");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("fake mp3", {
        headers: { "content-type": "audio/mpeg" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getMeetingAudio(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?download=1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Nascent Sync audio.mp3"',
    );
    expect(response.headers.get("location")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("https://r2.example.com/audio.mp3", expect.objectContaining({ cache: "no-store" }));
    await expect(response.text()).resolves.toBe("fake mp3");
  });

  it("redirects Recall recordings to the vendor audio URL when no R2 asset exists", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({ recordings: [] });
    findRecallRecordingMediaUrl.mockReturnValue(
      "https://recall.example.com/audio.mp3",
    );

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://recall.example.com/audio.mp3",
    );
    expect(createReadUrl).not.toHaveBeenCalled();
    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(findRecallRecordingMediaUrl).toHaveBeenCalledWith(
      { recordings: [] },
      "recording_123",
    );
    expect(retrieveRecallRecording).not.toHaveBeenCalled();
  });

  it("plays the selected recording part instead of the meeting's latest recording", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "bot_part_1",
        recallRecordingId: "recording_part_1",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({ recordings: [] });
    findRecallRecordingMediaUrl.mockReturnValue(
      "https://recall.example.com/part-1.mp3",
    );

    const response = await getMeetingAudio(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?recording=44444444-4444-4444-8444-444444444444",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://recall.example.com/part-1.mp3",
    );
    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_part_1");
    expect(findRecallRecordingMediaUrl).toHaveBeenCalledWith(
      { recordings: [] },
      "recording_part_1",
    );
  });

  it("redirects manual Recall recordings that do not have a bot", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: null,
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallRecording.mockResolvedValue({
      id: "recording_123",
      media_shortcuts: {},
    });
    findRecallRecordingMediaUrl.mockReturnValue(
      "https://recall.example.com/manual-recording.mp4",
    );

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://recall.example.com/manual-recording.mp4",
    );
    expect(retrieveRecallBot).not.toHaveBeenCalled();
    expect(retrieveRecallRecording).toHaveBeenCalledWith("recording_123");
    expect(findRecallRecordingMediaUrl).toHaveBeenCalledWith(
      { id: "recording_123", media_shortcuts: {} },
      "recording_123",
    );
  });

  it("falls back to the recording when a linked Recall bot is unavailable", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "deleted_bot",
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallBot.mockRejectedValue(new Error("Recall bot not found"));
    retrieveRecallRecording.mockResolvedValue({ id: "recording_123" });
    findRecallRecordingMediaUrl.mockReturnValue(
      "https://recall.example.com/recovered-recording.mp4",
    );

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://recall.example.com/recovered-recording.mp4",
    );
    expect(retrieveRecallBot).toHaveBeenCalledWith("deleted_bot");
    expect(retrieveRecallRecording).toHaveBeenCalledWith("recording_123");
  });

  it("falls back to the recording when the bot response omits its media", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({ recordings: [] });
    retrieveRecallRecording.mockResolvedValue({ id: "recording_123" });
    findRecallRecordingMediaUrl
      .mockReturnValueOnce(null)
      .mockReturnValueOnce("https://recall.example.com/direct-recording.mp4");

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://recall.example.com/direct-recording.mp4",
    );
    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(retrieveRecallRecording).toHaveBeenCalledWith("recording_123");
  });

  it("returns 404 when a Recall recording has no playable media URL", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({ recordings: [] });
    findRecallRecordingMediaUrl.mockReturnValue(null);

    const response = await getMeetingAudio();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Audio not found",
    });
  });
});
