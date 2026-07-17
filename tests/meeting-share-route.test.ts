import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMeetingSharePolicy,
  getCurrentUser,
  getWorkspace,
  listActiveMeetingShares,
  meetingSharePolicyAppliesToMeeting,
  revokeMeetingSharePolicy,
  select,
} = vi.hoisted(() => ({
  createMeetingSharePolicy: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  listActiveMeetingShares: vi.fn(),
  meetingSharePolicyAppliesToMeeting: vi.fn(),
  revokeMeetingSharePolicy: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));
vi.mock("@/lib/meeting-share-service", () => ({
  createMeetingSharePolicy,
  listActiveMeetingShares,
  meetingSharePolicyAppliesToMeeting,
  revokeMeetingSharePolicy,
}));
vi.mock("@/db/client", () => ({ db: { select } }));

const meetingId = "11111111-1111-4111-8111-111111111111";

async function shareMeetingRequest(body: unknown) {
  const { POST } = await import("@/app/api/meetings/[meetingId]/share/route");

  return POST(
    new Request(`https://app.example.com/api/meetings/${meetingId}/share`, {
      body: JSON.stringify(body),
      method: "POST",
    }),
    { params: Promise.resolve({ meetingId }) },
  );
}

async function deleteShareRequest(shareId: string) {
  const { DELETE } = await import("@/app/api/meetings/[meetingId]/share/route");

  return DELETE(
    new Request(
      `https://app.example.com/api/meetings/${meetingId}/share?shareId=${shareId}`,
      { method: "DELETE" },
    ),
    { params: Promise.resolve({ meetingId }) },
  );
}

function mockMeetingRows(rows: unknown[]) {
  select.mockReturnValueOnce({
    from: () => ({
      leftJoin: () => ({
        where: () => ({ limit: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
  });
}

function mockCandidateRows(rows: unknown[]) {
  select.mockReturnValueOnce({
    from: () => ({
      leftJoin: () => ({ where: vi.fn().mockResolvedValue(rows) }),
    }),
  });
}

describe("POST /api/meetings/[meetingId]/share", () => {
  beforeEach(() => {
    listActiveMeetingShares.mockResolvedValue([]);
    meetingSharePolicyAppliesToMeeting.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await shareMeetingRequest({
      email: "teammate@example.com",
      includeRelated: false,
    });

    expect(response.status).toBe(401);
    expect(createMeetingSharePolicy).not.toHaveBeenCalled();
  });

  it("shares one meeting through one atomic policy operation", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      domain: "example.com",
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: meetingId,
        ownerUserId: "owner_user_id",
        title: "Example <> Nascent",
      },
    ]);
    createMeetingSharePolicy.mockResolvedValue({ pending: false });

    const response = await shareMeetingRequest({
      email: " Teammate@Example.com ",
      includeRelated: false,
    });

    expect(response.status).toBe(200);
    expect(createMeetingSharePolicy).toHaveBeenCalledWith({
      createdByUserId: "owner_user_id",
      matchKeys: [],
      meetingIds: [meetingId],
      ownerUserId: "owner_user_id",
      recipientEmail: "teammate@example.com",
      scope: "single",
      seedMeetingId: meetingId,
      teamId: "team_123",
    });
  });

  it("previews related meetings without writing", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      domain: "example.com",
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([
      {
        attendeeEmails: ["founder@nascent.xyz", "owner@example.com"],
        id: meetingId,
        ownerUserId: "owner_user_id",
        title: "Example <> Nascent",
      },
    ]);
    mockCandidateRows([
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: meetingId,
        title: "Example <> Nascent",
      },
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: "22222222-2222-4222-8222-222222222222",
        title: "Quarterly update",
      },
    ]);

    const response = await shareMeetingRequest({
      email: "jeffrey@example.com",
      includeRelated: true,
      preview: true,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meetingCount: 2,
      preview: true,
      shared: false,
    });
    expect(createMeetingSharePolicy).not.toHaveBeenCalled();
  });

  it("shares all related meetings in one policy operation", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      domain: "example.com",
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([
      {
        attendeeEmails: ["founder@nascent.xyz", "owner@example.com"],
        id: meetingId,
        ownerUserId: "owner_user_id",
        title: "Example <> Nascent",
      },
    ]);
    mockCandidateRows([
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: meetingId,
        title: "Example <> Nascent",
      },
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: "22222222-2222-4222-8222-222222222222",
        title: "Quarterly update",
      },
    ]);
    createMeetingSharePolicy.mockResolvedValue({ pending: false });

    const response = await shareMeetingRequest({
      email: "jeffrey@example.com",
      includeRelated: true,
    });

    expect(response.status).toBe(200);
    expect(createMeetingSharePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingIds: [
          meetingId,
          "22222222-2222-4222-8222-222222222222",
        ],
        recipientEmail: "jeffrey@example.com",
        scope: "related",
      }),
    );
  });

  it("rejects related sharing when the meeting has no stable match", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      domain: "example.com",
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([
      {
        attendeeEmails: [],
        id: meetingId,
        ownerUserId: "owner_user_id",
        title: "Google Meet",
      },
    ]);

    const response = await shareMeetingRequest({
      email: "jeffrey@example.com",
      includeRelated: true,
    });

    expect(response.status).toBe(400);
    expect(createMeetingSharePolicy).not.toHaveBeenCalled();
  });

  it("revokes an active share policy", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      domain: "example.com",
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([
      {
        attendeeEmails: [],
        id: meetingId,
        ownerUserId: "owner_user_id",
        title: "Weekly sync",
      },
    ]);
    const shareId = "55555555-5555-4555-8555-555555555555";

    const response = await deleteShareRequest(shareId);

    expect(response.status).toBe(200);
    expect(revokeMeetingSharePolicy).toHaveBeenCalledWith(shareId);
  });
});
