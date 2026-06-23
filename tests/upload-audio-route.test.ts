import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const putObject = vi.fn();
const send = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    putObject,
  };
});

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
}));

async function postAudioUpload(file: File) {
  const { POST } = await import("@/app/api/uploads/audio/route");
  const formData = new FormData();
  formData.set("meeting-audio", file);

  return POST(
    new Request("https://app.example.com/api/uploads/audio", {
      method: "POST",
      body: formData,
    }),
  );
}

describe("POST /api/uploads/audio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getCurrentUser.mockReset();
    putObject.mockReset();
    send.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("queues transcription after storing the authenticated user's MP3", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    putObject.mockResolvedValue(undefined);
    send.mockResolvedValue({ ids: ["evt_123"] });

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
    });
    expect(putObject).toHaveBeenCalledWith({
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      body: expect.any(Uint8Array),
      contentType: "audio/mpeg",
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: {
        objectKey:
          "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      },
    });
  });

  it("rejects non-MP3 files", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postAudioUpload(
      new File(["fake wav"], "sample.wav", { type: "audio/wav" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid audio upload request",
    });
    expect(putObject).not.toHaveBeenCalled();
  });
});
