import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const createUploadUrl = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    createUploadUrl,
  };
});

async function postUpload(body: unknown) {
  const { POST } = await import("@/app/api/upload/route");

  return POST(
    new Request("https://app.example.com/api/upload", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

const validBody = {
  extension: "mp3",
  contentType: "audio/mpeg",
};

describe("POST /api/upload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getCurrentUser.mockReset();
    createUploadUrl.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postUpload(validBody);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("returns a controlled 500 when signing fails", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createUploadUrl.mockRejectedValue(new Error("missing R2 env"));

    const response = await postUpload(validBody);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Upload URL unavailable",
    });
  });

  it("rejects caller supplied namespace fields", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postUpload({
      ...validBody,
      teamId: "team_123",
      meetingId: "meeting_456",
      assetId: "asset_789",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid upload request",
    });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("returns a key scoped to the authenticated user namespace", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createUploadUrl.mockResolvedValue("https://upload.example.com/signed");

    const response = await postUpload(validBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      uploadUrl: "https://upload.example.com/signed",
      uploadId: "11111111-1111-4111-8111-111111111111",
    });
    expect(createUploadUrl).toHaveBeenCalledWith({
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      contentType: "audio/mpeg",
    });
  });

  it("does not include caller supplied team namespace in returned keys", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "22222222-2222-4222-8222-222222222222",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createUploadUrl.mockResolvedValue("https://upload.example.com/signed");

    const response = await postUpload({
      extension: "mp3",
      contentType: "audio/mpeg",
      teamId: "team_other",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid upload request",
    });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 400 for unsafe authenticated user id segments", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user/123",
      email: "user@example.com",
      name: null,
    });

    const response = await postUpload(validBody);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid upload request",
    });
    expect(createUploadUrl).not.toHaveBeenCalled();
  });
});
