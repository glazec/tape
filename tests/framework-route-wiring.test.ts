import { describe, expect, it, vi } from "vitest";

const { authHandler, handlers, serve } = vi.hoisted(() => {
  const handlers = {
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
    PATCH: vi.fn(),
  };

  return {
    authHandler: vi.fn(() => handlers),
    handlers,
    serve: vi.fn(() => handlers),
  };
});

vi.mock("@/lib/auth/server", () => ({
  auth: { handler: authHandler },
}));

vi.mock("inngest/next", () => ({ serve }));
vi.mock("@/inngest/client", () => ({ inngest: { id: "tape" } }));
vi.mock("@/inngest/functions", () => ({ functions: [] }));

describe("framework route wiring", () => {
  it("exports the configured auth handlers", async () => {
    const route = await import("@/app/api/auth/[...path]/route");

    expect(authHandler).toHaveBeenCalledOnce();
    expect(route).toMatchObject(handlers);
  });

  it("exports the configured Inngest handlers", async () => {
    const route = await import("@/app/api/inngest/route");

    expect(serve).toHaveBeenCalledWith({
      client: { id: "tape" },
      functions: [],
    });
    expect(route).toMatchObject({
      GET: handlers.GET,
      POST: handlers.POST,
      PUT: handlers.PUT,
    });
  });
});
