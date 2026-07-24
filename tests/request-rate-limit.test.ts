import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/db/client", () => ({
  privilegedDb: { execute },
}));

describe("request rate limits", () => {
  afterEach(() => {
    execute.mockReset();
    vi.resetModules();
  });

  it("allows requests within the persistent window limit", async () => {
    execute.mockResolvedValue({ rows: [{ request_count: 3 }] });
    const { assertRequestRateLimit } = await import(
      "@/lib/request-rate-limit"
    );

    await expect(
      assertRequestRateLimit({
        limit: 10,
        now: new Date("2026-07-24T16:15:00.000Z"),
        scope: "upload",
        subject: "team_123:user_123",
        windowMs: 3_600_000,
      }),
    ).resolves.toEqual({
      limit: 10,
      remaining: 7,
      resetAt: new Date("2026-07-24T17:00:00.000Z"),
    });
  });

  it("returns a retryable 429 after the limit is exceeded", async () => {
    execute.mockResolvedValue({ rows: [{ request_count: 11 }] });
    const {
      assertRequestRateLimit,
      requestRateLimitErrorResponse,
    } = await import("@/lib/request-rate-limit");
    const error = await assertRequestRateLimit({
      limit: 10,
      now: new Date("2026-07-24T16:59:30.000Z"),
      scope: "upload",
      subject: "team_123:user_123",
      windowMs: 3_600_000,
    }).catch((caught) => caught);
    const response = requestRateLimitErrorResponse(error);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("30");
  });
});
