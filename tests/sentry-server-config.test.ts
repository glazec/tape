import { afterEach, describe, expect, it, vi } from "vitest";

const { createServerTraceProcessor, init, isEnabled, loggerInfo } =
  vi.hoisted(() => ({
    createServerTraceProcessor: vi.fn(),
    init: vi.fn(),
    isEnabled: vi.fn(() => true),
    loggerInfo: vi.fn(),
  }));

vi.mock("@sentry/nextjs", () => ({
  init,
  isEnabled,
  logger: { info: loggerInfo },
}));

vi.mock("@/lib/telemetry/server", () => ({
  createServerTraceProcessor,
}));

const originalEnvironment = { ...process.env };

describe("Sentry server configuration", () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
    createServerTraceProcessor.mockReset();
    init.mockClear();
    isEnabled.mockClear();
    isEnabled.mockReturnValue(true);
    loggerInfo.mockClear();
    vi.resetModules();
  });

  it("attaches the SigNoz processor to Sentry's tracer provider", async () => {
    const traceProcessor = { forceFlush: vi.fn() };
    process.env.NEXT_PUBLIC_SENTRY_DSN =
      "https://public@example.ingest.sentry.io/1";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "https://otel-collector.example.com";
    createServerTraceProcessor.mockReturnValue(traceProcessor);

    await import("@/sentry.server.config");

    expect(createServerTraceProcessor).toHaveBeenCalledWith({
      defaultServiceName: "tape-web",
    });
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        openTelemetrySpanProcessors: [traceProcessor],
        tracesSampleRate: 1,
      }),
    );
  });
});
