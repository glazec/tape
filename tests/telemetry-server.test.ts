import { afterEach, describe, expect, it, vi } from "vitest";

const {
  exporterOptions,
  forceFlush,
  loggerEmit,
  processorOptions,
  registerOTel,
} = vi.hoisted(() => ({
  exporterOptions: vi.fn(),
  forceFlush: vi.fn().mockResolvedValue(undefined),
  loggerEmit: vi.fn(),
  processorOptions: vi.fn(),
  registerOTel: vi.fn(),
}));

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLogger: vi.fn(() => ({ emit: loggerEmit })),
  },
  SeverityNumber: {
    DEBUG: 5,
    ERROR: 17,
    INFO: 9,
    WARN: 13,
  },
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    constructor(options: unknown) {
      exporterOptions(options);
    }
  },
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: class {
    constructor(options: unknown) {
      processorOptions(options);
    }

    forceFlush = forceFlush;
  },
}));

vi.mock("@vercel/otel", () => ({
  OTLPHttpJsonTraceExporter: class {
    constructor(options: unknown) {
      exporterOptions(options);
    }
  },
  registerOTel,
}));

const originalEnvironment = { ...process.env };
const originalConsole = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
};

describe("server telemetry", () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
    Object.assign(console, originalConsole);
    delete (
      globalThis as typeof globalThis & {
        __tapeTelemetryState?: unknown;
      }
    ).__tapeTelemetryState;
    exporterOptions.mockClear();
    forceFlush.mockClear();
    loggerEmit.mockClear();
    processorOptions.mockClear();
    registerOTel.mockClear();
    vi.resetModules();
  });

  it("does not register without a collector endpoint", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    const { registerServerTelemetry } = await import(
      "@/lib/telemetry/server"
    );

    expect(registerServerTelemetry()).toBe(false);
    expect(registerOTel).not.toHaveBeenCalled();
  });

  it("registers traces and logs and redacts sensitive attributes", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "https://otel-collector.example.com";
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    const {
      emitTelemetryLog,
      flushTelemetry,
      registerServerTelemetry,
    } = await import("@/lib/telemetry/server");

    expect(registerServerTelemetry()).toBe(true);
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: "tape-web",
      }),
    );
    expect(exporterOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://otel-collector.example.com/v1/logs",
      }),
    );
    expect(exporterOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://otel-collector.example.com/v1/traces",
      }),
    );

    emitTelemetryLog({
      attributes: {
        meetingId: "meeting-123",
        token: "provider-secret",
      },
      error: new Error("failed https://example.com/path?token=secret"),
      eventName: "test.failure",
      severity: "ERROR",
    });
    await flushTelemetry();

    expect(loggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "exception.message": "failed https://example.com/path",
          meetingId: "meeting-123",
          token: "[redacted]",
        }),
        eventName: "test.failure",
        severityNumber: 17,
      }),
    );
    expect(forceFlush).toHaveBeenCalledOnce();
  });
});
