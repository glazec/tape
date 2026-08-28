import { afterEach, describe, expect, it, vi } from "vitest";

const {
  exporterOptions,
  forceFlush,
  loggerProviderOptions,
  loggerEmit,
  logExport,
  processorOptions,
  registerOTel,
  setGlobalLoggerProvider,
  spanProcessorOptions,
  traceExport,
  traceForceFlush,
} = vi.hoisted(() => ({
  exporterOptions: vi.fn(),
  forceFlush: vi.fn().mockResolvedValue(undefined),
  loggerProviderOptions: vi.fn(),
  loggerEmit: vi.fn(),
  logExport: vi.fn(
    (_records: unknown, callback: (result: { code: number }) => void) =>
      callback({ code: 0 }),
  ),
  processorOptions: vi.fn(),
  registerOTel: vi.fn(),
  setGlobalLoggerProvider: vi.fn((provider: unknown) => provider),
  spanProcessorOptions: vi.fn(),
  traceExport: vi.fn(
    (_spans: unknown, callback: (result: { code: number }) => void) =>
      callback({ code: 0 }),
  ),
  traceForceFlush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLogger: vi.fn(() => ({ emit: loggerEmit })),
    setGlobalLoggerProvider,
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

    export(records: unknown, callback: (result: { code: number }) => void) {
      logExport(records, callback);
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
  LoggerProvider: class {
    constructor(options: unknown) {
      loggerProviderOptions(options);
    }
  },
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn((attributes: unknown) => attributes),
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: class {
    constructor(options: unknown) {
      spanProcessorOptions(options);
    }

    forceFlush = traceForceFlush;
  },
}));

vi.mock("@vercel/otel", () => ({
  OTLPHttpJsonTraceExporter: class {
    constructor(options: unknown) {
      exporterOptions(options);
    }

    export(spans: unknown, callback: (result: { code: number }) => void) {
      traceExport(spans, callback);
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
        __tapeTelemetryFailures?: unknown;
        __tapeTelemetryState?: unknown;
        __tapeTelemetryTraceProcessor?: unknown;
      }
    ).__tapeTelemetryState;
    delete (
      globalThis as typeof globalThis & {
        __tapeTelemetryFailures?: unknown;
        __tapeTelemetryTraceProcessor?: unknown;
      }
    ).__tapeTelemetryFailures;
    delete (
      globalThis as typeof globalThis & {
        __tapeTelemetryTraceProcessor?: unknown;
      }
    ).__tapeTelemetryTraceProcessor;
    exporterOptions.mockClear();
    forceFlush.mockClear();
    forceFlush.mockResolvedValue(undefined);
    loggerProviderOptions.mockClear();
    loggerEmit.mockClear();
    logExport.mockClear();
    logExport.mockImplementation(
      (_records: unknown, callback: (result: { code: number }) => void) =>
        callback({ code: 0 }),
    );
    processorOptions.mockClear();
    registerOTel.mockReset();
    setGlobalLoggerProvider.mockClear();
    setGlobalLoggerProvider.mockImplementation(
      (provider: unknown) => provider,
    );
    spanProcessorOptions.mockClear();
    traceExport.mockClear();
    traceForceFlush.mockClear();
    traceForceFlush.mockResolvedValue(undefined);
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

  it("promotes structured console error context into queryable fields", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "https://otel-collector.example.com";
    console.error = vi.fn();
    const { createTelemetryErrorContext } = await import(
      "@/lib/telemetry/error-context"
    );
    const { registerServerTelemetry } = await import(
      "@/lib/telemetry/server"
    );

    registerServerTelemetry();
    console.error("meeting_link_scheduling_failure", {
      errorMessage: "Recall request failed",
      telemetry: createTelemetryErrorContext({
        error: new TypeError("Recall request failed"),
        eventName: "meeting_link_scheduling_failure",
        handled: true,
        operation: "meeting.bot.schedule",
        source: "server",
      }),
    });

    expect(loggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "error.fingerprint":
            "meeting_link_scheduling_failure:meeting.bot.schedule:typeerror",
          "error.handled": true,
          "error.message": "Recall request failed",
          "error.type": "TypeError",
          "operation.name": "meeting.bot.schedule",
          "telemetry.source": "server",
        }),
        eventName: "meeting_link_scheduling_failure",
        severityNumber: 17,
      }),
    );
  });

  it("uses Sentry's tracer provider while retaining OTLP traces and logs", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "https://otel-collector.example.com";
    delete process.env.OTEL_SERVICE_NAME;
    process.env.OTEL_RESOURCE_ATTRIBUTES = "custom.attribute=preserved";
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    const {
      createServerTraceProcessor,
      emitTelemetryLog,
      flushTelemetry,
      registerServerTelemetry,
    } = await import("@/lib/telemetry/server");

    const traceProcessor = createServerTraceProcessor({
      defaultServiceName: "tape-web",
    });

    expect(traceProcessor).not.toBeNull();
    expect(process.env.OTEL_SERVICE_NAME).toBe("tape-web");
    expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toContain(
      "custom.attribute=preserved",
    );
    expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toContain(
      "service.namespace=tape",
    );
    expect(process.env.OTEL_RESOURCE_ATTRIBUTES).toContain(
      "deployment.environment.name=production",
    );
    expect(spanProcessorOptions).toHaveBeenCalledOnce();
    expect(
      registerServerTelemetry({
        defaultServiceName: "tape-web",
        tracingOwner: "sentry",
      }),
    ).toBe(true);
    expect(registerOTel).not.toHaveBeenCalled();
    expect(loggerProviderOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({ "service.name": "tape-web" }),
      }),
    );
    expect(setGlobalLoggerProvider).toHaveBeenCalledOnce();

    emitTelemetryLog({ eventName: "web.request.completed" });
    await flushTelemetry();

    expect(loggerEmit).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "web.request.completed" }),
    );
    expect(forceFlush).toHaveBeenCalledOnce();
    expect(traceForceFlush).not.toHaveBeenCalled();
  });

  it("reports registration failures once through sanitized stderr", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "https://otel-collector.example.com";
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    registerOTel.mockImplementation(() => {
      throw new Error(
        "collector rejected https://example.com/v1/traces?token=secret",
      );
    });
    const { registerServerTelemetry } = await import(
      "@/lib/telemetry/server"
    );

    expect(registerServerTelemetry()).toBe(false);
    expect(registerServerTelemetry()).toBe(false);

    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0]?.[0]).toContain(
      '"eventName":"telemetry.pipeline.failure"',
    );
    expect(stderr.mock.calls[0]?.[0]).toContain('"stage":"registration"');
    expect(stderr.mock.calls[0]?.[0]).not.toContain("token=secret");
    stderr.mockRestore();
  });

  it("reports rejected OTLP log exports once without recursion", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
      "https://otel-collector.example.com";
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    logExport.mockImplementation(
      (
        _records: unknown,
        callback: (result: { code: number; error?: Error }) => void,
      ) => callback({ code: 1, error: new Error("collector unavailable") }),
    );
    const { registerServerTelemetry } = await import(
      "@/lib/telemetry/server"
    );

    registerServerTelemetry();
    const exporter = (
      processorOptions.mock.calls[0]?.[0] as {
        exporter: {
          export: (
            records: unknown[],
            callback: (result: { code: number }) => void,
          ) => void;
        };
      }
    ).exporter;
    exporter.export([], vi.fn());
    exporter.export([], vi.fn());

    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0]?.[0]).toContain('"stage":"log_export"');
    stderr.mockRestore();
  });
});
