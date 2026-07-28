import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertRequestRateLimit,
  getCachedDashboardSummaryForWorkspace,
  getCurrentUser,
  getDashboardSummaryCacheTag,
  getWorkspace,
  requestRateLimitErrorResponse,
  revalidateTag,
} = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  getCachedDashboardSummaryForWorkspace: vi.fn(),
  getCurrentUser: vi.fn(),
  getDashboardSummaryCacheTag: vi.fn(),
  getWorkspace: vi.fn(),
  requestRateLimitErrorResponse: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/dashboard-summary-cache", () => ({
  getCachedDashboardSummaryForWorkspace,
  getDashboardSummaryCacheTag,
}));

vi.mock("@/lib/request-rate-limit", () => ({
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies: {
    dashboardSummaryRefresh: {
      limit: 6,
      scope: "dashboard_summary_refresh",
      windowMs: 60_000,
    },
  },
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

describe("dashboard summary refresh route", () => {
  afterEach(() => {
    assertRequestRateLimit.mockReset();
    getCachedDashboardSummaryForWorkspace.mockReset();
    getCurrentUser.mockReset();
    getDashboardSummaryCacheTag.mockReset();
    getWorkspace.mockReset();
    requestRateLimitErrorResponse.mockReset();
    revalidateTag.mockReset();
    vi.resetModules();
  });

  it("requires an authenticated user", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/dashboard/summary/refresh/route"
    );

    const response = await POST();

    expect(response.status).toBe(401);
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it("expires and recomputes only the current user summary", async () => {
    const user = {
      id: "auth_user_123",
      email: "member@example.com",
      name: "Tape User",
    };
    const workspace = {
      teamId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
      canCreateMeetings: true,
    };
    const result = {
      cachedAt: "2026-07-27T12:00:00.000Z",
      summary: {
        userStats: {
          thisWeekMeetings: 3,
        },
      },
    };

    getCurrentUser.mockResolvedValue(user);
    getWorkspace.mockResolvedValue(workspace);
    getDashboardSummaryCacheTag.mockReturnValue("dashboard-summary:user");
    getCachedDashboardSummaryForWorkspace.mockResolvedValue(result);
    const { POST } = await import(
      "@/app/api/dashboard/summary/refresh/route"
    );

    const response = await POST();

    expect(assertRequestRateLimit).toHaveBeenCalledWith({
      limit: 6,
      scope: "dashboard_summary_refresh",
      subject: workspace.userId,
      windowMs: 60_000,
    });
    expect(revalidateTag).toHaveBeenCalledWith("dashboard-summary:user", {
      expire: 0,
    });
    expect(getCachedDashboardSummaryForWorkspace).toHaveBeenCalledWith(
      workspace,
      {
        userEmail: user.email,
        userName: user.name,
      },
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(result);
  });

  it("does not compute private stats for shared only users", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "shared@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
      canCreateMeetings: false,
    });
    const { POST } = await import(
      "@/app/api/dashboard/summary/refresh/route"
    );

    const response = await POST();

    expect(response.status).toBe(403);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(getCachedDashboardSummaryForWorkspace).not.toHaveBeenCalled();
  });

  it("rate limits repeated refresh attempts before invalidating the cache", async () => {
    const rateLimitError = new Error("rate limited");

    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@example.com",
      name: "Tape User",
    });
    getWorkspace.mockResolvedValue({
      teamId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
      canCreateMeetings: true,
    });
    assertRequestRateLimit.mockRejectedValue(rateLimitError);
    requestRateLimitErrorResponse.mockReturnValue(
      Response.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      ),
    );
    const { POST } = await import(
      "@/app/api/dashboard/summary/refresh/route"
    );

    const response = await POST();

    expect(response.status).toBe(429);
    expect(requestRateLimitErrorResponse).toHaveBeenCalledWith(
      rateLimitError,
    );
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(getCachedDashboardSummaryForWorkspace).not.toHaveBeenCalled();
  });
});
