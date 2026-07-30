import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  emitTelemetryLog,
  flushTelemetry,
  getAuthenticatedUser,
  isServerTelemetryEnabled,
} = vi.hoisted(() => ({
  emitTelemetryLog: vi.fn(),
  flushTelemetry: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  isServerTelemetryEnabled: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser }));
vi.mock("@/lib/telemetry/server", () => ({
  emitTelemetryLog,
  flushTelemetry,
  isServerTelemetryEnabled,
}));

async function postTelemetry(
  body: unknown,
  headers?: Record<string, string>,
) {
  const { POST } = await import("@/app/api/telemetry/events/route");

  return POST(
    new Request("https://tape.example.com/api/telemetry/events", {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      method: "POST",
    }),
  );
}

describe("POST /api/telemetry/events", () => {
  afterEach(() => {
    emitTelemetryLog.mockReset();
    flushTelemetry.mockReset();
    getAuthenticatedUser.mockReset();
    isServerTelemetryEnabled.mockReset();
    vi.resetModules();
  });

  it("is a no-op when server telemetry is disabled", async () => {
    isServerTelemetryEnabled.mockReturnValue(false);

    const response = await postTelemetry({ events: [] });

    expect(response.status).toBe(204);
    expect(emitTelemetryLog).not.toHaveBeenCalled();
  });

  it("rejects cross-origin event intake", async () => {
    isServerTelemetryEnabled.mockReturnValue(true);

    const response = await postTelemetry(
      { events: [] },
      { Origin: "https://attacker.example.com" },
    );

    expect(response.status).toBe(403);
  });

  it("emits sanitized behavior and error logs with a pseudonymous user", async () => {
    isServerTelemetryEnabled.mockReturnValue(true);
    getAuthenticatedUser.mockResolvedValue({
      email: "alice@example.com",
      id: "auth-user-123",
      name: "Alice",
    });

    const occurredAt = "2026-07-25T20:00:00.000Z";
    const response = await postTelemetry({
      events: [
        {
          action: "button",
          destinationRoute:
            "/meetings/11111111-1111-4111-8111-111111111111?secret=yes",
          occurredAt,
          route:
            "/meetings/11111111-1111-4111-8111-111111111111?secret=yes",
          sessionId: "22222222-2222-4222-8222-222222222222",
          targetType: "button",
          type: "user_action",
        },
        {
          errorMessage:
            "failed https://example.com/private?signature=secret",
          errorName: "TypeError",
          occurredAt,
          route: "/dashboard",
          sessionId: "22222222-2222-4222-8222-222222222222",
          testSessionId: "33333333-3333-4333-8333-333333333333",
          type: "client_error",
        },
      ],
    });

    expect(response.status).toBe(204);
    expect(emitTelemetryLog).toHaveBeenCalledTimes(2);
    expect(emitTelemetryLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({
          "enduser.id": createHash("sha256")
            .update("auth-user-123")
            .digest("hex"),
          "page.destination_route": "/meetings/:id",
          "page.route": "/meetings/:id",
        }),
        eventName: "frontend.user_action",
        severity: "INFO",
      }),
    );
    expect(emitTelemetryLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attributes: expect.objectContaining({
          "error.fingerprint":
            "frontend.client_error:browser.runtime:dashboard:typeerror",
          "error.handled": false,
          "error.message": "failed https://example.com/private",
          "error.type": "TypeError",
          "operation.name": "browser.runtime",
          "telemetry.synthetic": true,
          "test.session.id":
            "33333333-3333-4333-8333-333333333333",
        }),
        eventName: "frontend.client_error",
        severity: "ERROR",
      }),
    );
    expect(flushTelemetry).toHaveBeenCalledOnce();
  });

  it("rejects malformed event batches", async () => {
    isServerTelemetryEnabled.mockReturnValue(true);

    const response = await postTelemetry({ events: [] });

    expect(response.status).toBe(400);
  });
});
