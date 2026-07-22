import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMeetingSharePolicy,
  getCurrentUser,
  getTeamConfiguration,
  getWorkspace,
  listActiveMeetingShares,
  listWorkspaceShareRecipients,
  meetingSharePolicyAppliesToMeeting,
  revokeMeetingRecipientAccess,
  revokeMeetingSharePolicy,
  select,
} = vi.hoisted(() => ({
  createMeetingSharePolicy: vi.fn(),
  getCurrentUser: vi.fn(),
  getTeamConfiguration: vi.fn(),
  getWorkspace: vi.fn(),
  listActiveMeetingShares: vi.fn(),
  listWorkspaceShareRecipients: vi.fn(),
  meetingSharePolicyAppliesToMeeting: vi.fn(),
  revokeMeetingRecipientAccess: vi.fn(),
  revokeMeetingSharePolicy: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));
vi.mock("@/lib/team-configuration", () => ({ getTeamConfiguration }));
vi.mock("@/lib/meeting-share-service", () => ({
  createMeetingSharePolicy,
  listActiveMeetingShares,
  meetingSharePolicyAppliesToMeeting,
  revokeMeetingRecipientAccess,
  revokeMeetingSharePolicy,
}));
vi.mock("@/lib/meeting-queries", () => ({ listWorkspaceShareRecipients }));
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

async function getSharesRequest() {
  const { GET } = await import("@/app/api/meetings/[meetingId]/share/route");

  return GET(
    new Request(`https://app.example.com/api/meetings/${meetingId}/share`),
    { params: Promise.resolve({ meetingId }) },
  );
}

async function shareMeetingRawRequest(body: string) {
  const { POST } = await import("@/app/api/meetings/[meetingId]/share/route");

  return POST(
    new Request(`https://app.example.com/api/meetings/${meetingId}/share`, {
      body,
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

async function removeRecipientRequest(email: string) {
  const { DELETE } = await import("@/app/api/meetings/[meetingId]/share/route");

  return DELETE(
    new Request(
      `https://app.example.com/api/meetings/${meetingId}/share?email=${encodeURIComponent(email)}`,
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
    getTeamConfiguration.mockResolvedValue({
      name: "Example Capital",
      shareAudience: {
        emails: [
          "partner@example.com",
          "principal@example.com",
          "owner@example.com",
        ],
        name: "Investment committee",
      },
    });
    listActiveMeetingShares.mockResolvedValue([]);
    listWorkspaceShareRecipients.mockResolvedValue([]);
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

  it("lists the active shares for a manageable meeting", async () => {
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
    listActiveMeetingShares.mockResolvedValue([
      {
        email: "guest@example.com",
        id: "share_123",
        pending: false,
        scope: "single",
      },
    ]);

    const response = await getSharesRequest();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      shares: [
        {
          email: "guest@example.com",
          id: "share_123",
          pending: false,
          scope: "single",
        },
      ],
    });
    expect(listActiveMeetingShares).toHaveBeenCalledWith(meetingId);
  });

  it("rejects malformed JSON", async () => {
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

    const response = await shareMeetingRawRequest("{");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid sharing details",
    });
    expect(createMeetingSharePolicy).not.toHaveBeenCalled();
  });

  it("does not create a duplicate active share", async () => {
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
    listActiveMeetingShares.mockResolvedValue([
      {
        email: "guest@example.com",
        id: "share_123",
        pending: false,
        scope: "single",
      },
    ]);

    const response = await shareMeetingRequest({
      email: "guest@example.com",
      includeRelated: false,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      alreadyShared: true,
      email: "guest@example.com",
      shared: true,
    });
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

  it("shares a meeting with the whole workspace organization", async () => {
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
        ownerEmail: "owner@example.com",
        ownerUserId: "owner_user_id",
        title: "Weekly sync",
      },
    ]);
    listWorkspaceShareRecipients.mockResolvedValue([
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com", name: "Bob" },
    ]);
    createMeetingSharePolicy.mockResolvedValue({ pending: false });

    const response = await shareMeetingRequest({ audience: "organization" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      audience: "organization",
      recipientCount: 2,
      shared: true,
    });
    expect(listWorkspaceShareRecipients).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team_123" }),
    );
    expect(createMeetingSharePolicy).toHaveBeenCalledTimes(2);
    expect(
      createMeetingSharePolicy.mock.calls.map(([input]) => input.recipientEmail),
    ).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("shares with every configured group member except the current user", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: "YiPing Lu",
    });
    getWorkspace.mockResolvedValue({
      domain: "iosg.vc",
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([
      {
        attendeeEmails: [],
        id: meetingId,
        ownerUserId: "owner_user_id",
        title: "IC meeting",
      },
    ]);
    createMeetingSharePolicy.mockResolvedValue({ pending: true });

    const response = await shareMeetingRequest({ audience: "team_group" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      audience: "team_group",
      recipientCount: 2,
      shared: true,
    });
    expect(createMeetingSharePolicy).toHaveBeenCalledTimes(2);
    expect(
      createMeetingSharePolicy.mock.calls.map(([input]) => input.recipientEmail),
    ).toEqual(["partner@example.com", "principal@example.com"]);
    expect(createMeetingSharePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingIds: [meetingId],
        scope: "single",
        teamId: "team_123",
      }),
    );
  });

  it("rejects a team group when none is configured", async () => {
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
        title: "Customer meeting",
      },
    ]);

    getTeamConfiguration.mockResolvedValue({
      name: "Example Capital",
      shareAudience: null,
    });

    const response = await shareMeetingRequest({ audience: "team_group" });

    expect(response.status).toBe(400);
    expect(createMeetingSharePolicy).not.toHaveBeenCalled();
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
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: "33333333-3333-4333-8333-333333333333",
        title: "Product update",
      },
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: "44444444-4444-4444-8444-444444444444",
        title: "Fundraising update",
      },
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: "55555555-5555-4555-8555-555555555555",
        title: "Portfolio update",
      },
      {
        attendeeEmails: ["founder@nascent.xyz"],
        id: "66666666-6666-4666-8666-666666666666",
        title: "Annual update",
      },
    ]);

    const response = await shareMeetingRequest({
      email: "jeffrey@example.com",
      includeRelated: true,
      preview: true,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      meetingCount: 6,
      preview: true,
      shared: false,
    });
    expect(result.meetings).toHaveLength(6);
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

  it("rejects related sharing based on a title alone", async () => {
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
        title: "Weekly investor update",
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

  it("explains why an unauthenticated recipient removal is rejected", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await removeRecipientRequest("guest@example.com");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(revokeMeetingRecipientAccess).not.toHaveBeenCalled();
  });

  it("removes one recipient from the meeting access list", async () => {
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

    const response = await removeRecipientRequest(" Guest@Example.com ");

    expect(response.status).toBe(200);
    expect(revokeMeetingRecipientAccess).toHaveBeenCalledWith({
      createdByUserId: "owner_user_id",
      meetingId,
      recipientEmail: "guest@example.com",
    });
  });
});
