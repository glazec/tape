import { afterEach, describe, expect, it, vi } from "vitest";

const { emitTelemetryLog, flushTelemetry } = vi.hoisted(() => ({
  emitTelemetryLog: vi.fn(),
  flushTelemetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/telemetry/server", () => ({
  emitTelemetryLog,
  flushTelemetry,
}));

describe("Inngest telemetry middleware", () => {
  afterEach(() => {
    emitTelemetryLog.mockReset();
    flushTelemetry.mockClear();
    vi.resetModules();
  });

  it("emits queryable context only after the final failed attempt", async () => {
    const { TapeTelemetryMiddleware } = await import(
      "@/lib/telemetry/inngest-middleware"
    );
    const middleware = Object.create(
      TapeTelemetryMiddleware.prototype,
    );
    const error = new TypeError("provider timed out");
    const input = {
      ctx: {
        attempt: 2,
        runId: "01JTESTINNGESTRUN",
      },
      error,
      fn: {
        id: () => "meeting-transcript-enrich-transcript",
        name: "Enrich transcript",
      },
      isFinalAttempt: false,
    };

    await middleware.onRunError(input as never);
    expect(emitTelemetryLog).not.toHaveBeenCalled();

    await middleware.onRunError({
      ...input,
      isFinalAttempt: true,
    } as never);

    expect(emitTelemetryLog).toHaveBeenCalledWith({
      attributes: {
        "error.fingerprint":
          "inngest.function.failure:inngest.function.run:meeting-transcript-enrich-transcript:typeerror",
        "error.handled": false,
        "error.type": "TypeError",
        "inngest.attempt": 2,
        "inngest.function.id":
          "meeting-transcript-enrich-transcript",
        "inngest.function.name": "Enrich transcript",
        "inngest.run.id": "01JTESTINNGESTRUN",
        "operation.name": "inngest.function.run",
        "telemetry.source": "inngest",
      },
      error,
      eventName: "inngest.function.failure",
      severity: "ERROR",
    });
    expect(flushTelemetry).toHaveBeenCalledOnce();
  });
});
