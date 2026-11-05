import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, replaceMeetingLink } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  replaceMeetingLink: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/provider-credit", () => ({
  providerCreditErrorResponse: () => null,
}));
vi.mock("@/lib/meeting-link-replacement", () => ({
  MeetingLinkReplacementUnavailableError: class extends Error {
    constructor() {
      super("This meeting has already started recording");
    }
  },
  SameMeetingLinkError: class extends Error {},
  UnsupportedMeetingLinkError: class extends Error {
    constructor() {
      super("Use a Google Meet or Zoom link");
    }
  },
  replaceMeetingLink,
}));

const meetingId = "11111111-1111-4111-8111-111111111111";
const user = { email: "test@iosg.vc", id: "user_123", name: null };

async function putLink(id: string, body: unknown) {
  const { PUT } = await import("@/app/api/meetings/[meetingId]/link/route");

  return PUT(
    new Request(`https://app.example.com/api/meetings/${id}/link`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    }),
    { params: Promise.resolve({ meetingId: id }) },
  );
}

describe("PUT /api/meetings/[meetingId]/link", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    replaceMeetingLink.mockReset();
    vi.resetModules();
  });

  it("replaces the link and returns the new bot", async () => {
    getCurrentUser.mockResolvedValue(user);
    replaceMeetingLink.mockResolvedValue({
      botId: "new_bot",
      meetingId,
      meetingUrl: "https://zoom.us/j/123456789",
      platform: "zoom",
      status: "joining",
    });

    const response = await putLink(meetingId, {
      meetingUrl: "https://zoom.us/j/123456789",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "new_bot",
      status: "joining",
    });
    expect(replaceMeetingLink).toHaveBeenCalledWith({
      meetingId,
      meetingUrl: "https://zoom.us/j/123456789",
      sessionUser: user,
    });
  });

  it("requires sign in", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await putLink(meetingId, {
      meetingUrl: "https://zoom.us/j/1",
    });

    expect(response.status).toBe(401);
    expect(replaceMeetingLink).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    getCurrentUser.mockResolvedValue(user);

    const response = await putLink(meetingId, { meetingUrl: "not a url" });

    expect(response.status).toBe(400);
    expect(replaceMeetingLink).not.toHaveBeenCalled();
  });

  it("reports an unsupported link", async () => {
    getCurrentUser.mockResolvedValue(user);
    const { UnsupportedMeetingLinkError } = await import(
      "@/lib/meeting-link-replacement"
    );
    replaceMeetingLink.mockRejectedValue(new UnsupportedMeetingLinkError());

    const response = await putLink(meetingId, {
      meetingUrl: "https://example.com/x",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Use a Google Meet or Zoom link",
    });
  });

  it("reports a meeting that is already recording", async () => {
    getCurrentUser.mockResolvedValue(user);
    const { MeetingLinkReplacementUnavailableError } = await import(
      "@/lib/meeting-link-replacement"
    );
    replaceMeetingLink.mockRejectedValue(
      new MeetingLinkReplacementUnavailableError(),
    );

    const response = await putLink(meetingId, {
      meetingUrl: "https://zoom.us/j/1",
    });

    expect(response.status).toBe(409);
  });
});
