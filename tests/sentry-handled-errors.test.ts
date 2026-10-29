import { afterEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(), captureMessage: vi.fn(),
  isEnabled: vi.fn(() => true), flush: vi.fn().mockResolvedValue(true),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@sentry/nextjs", () => sentry);
import { emitTelemetryLog, registerServerTelemetry } from "@/lib/telemetry/server";

const originalConsole = { ...console };
afterEach(() => {
  Object.assign(console, originalConsole);
  Reflect.deleteProperty(globalThis, "__tapeConsoleInstrumented");
  Reflect.deleteProperty(globalThis, "__tapeConsoleEmitting");
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Sentry issue coverage", () => {
  it("captures handled errors with operation and stable fingerprint", () => {
    const error = new Error("Provider failed");
    emitTelemetryLog({ eventName: "upload.failed", severity: "ERROR", error,
      attributes: { "operation.name": "upload", "error.handled": true, "error.fingerprint": "upload:provider" } });
    expect(sentry.captureException).toHaveBeenCalledWith(error, expect.objectContaining({
      tags: expect.objectContaining({ "operation.name": "upload", "error.handled": true }),
      fingerprint: ["upload:provider"],
    }));
    expect(sentry.logger.error).toHaveBeenCalledOnce();
  });

  it("captures final background job failures even though they are unhandled", () => {
    emitTelemetryLog({ eventName: "inngest.function.failure", severity: "ERROR", error: new Error("Exhausted"),
      attributes: { "error.handled": false, "telemetry.source": "inngest" } });
    expect(sentry.captureException).toHaveBeenCalledOnce();
  });

  it("does not duplicate Next request errors or promote warnings", () => {
    emitTelemetryLog({ eventName: "nextjs.request.error", severity: "ERROR", error: new Error("Request") });
    emitTelemetryLog({ eventName: "retry", severity: "WARN", error: new Error("Retry") });
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("captures console errors once with only Sentry configured, including Error as the first argument", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");
    vi.stubEnv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "");
    expect(registerServerTelemetry()).toBe(true);
    registerServerTelemetry();
    const error = new Error("Handled console failure");
    console.error(error);
    expect(sentry.captureException).toHaveBeenCalledExactlyOnceWith(error, expect.any(Object));
  });

  it("creates a message issue for errors without Error objects without copying arbitrary payloads", () => {
    emitTelemetryLog({ eventName: "upload.failed", severity: "ERROR", attributes: { token: "private", content: "private" } });
    expect(sentry.captureMessage).toHaveBeenCalledWith("upload.failed", expect.objectContaining({ level: "error" }));
    expect(JSON.stringify(sentry.captureMessage.mock.calls)).not.toContain("private");
  });

  it("keeps the application outcome if exception capture fails", () => {
    sentry.captureException.mockImplementationOnce(() => { throw new Error("SDK failure"); });
    expect(() => emitTelemetryLog({ eventName: "upload.failed", severity: "ERROR", error: new Error("Original") })).not.toThrow();
  });
});
