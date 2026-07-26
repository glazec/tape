import { describe, expect, it } from "vitest";

import {
  getTelemetryConfig,
  normalizeOtlpEndpoint,
  parseOtlpHeaders,
} from "@/lib/telemetry/config";
import {
  sanitizeTelemetryAttributes,
  sanitizeTelemetryRoute,
  sanitizeTelemetryText,
} from "@/lib/telemetry/sanitize";

describe("telemetry configuration", () => {
  it("keeps telemetry disabled without a collector endpoint", () => {
    expect(getTelemetryConfig({})).toBeNull();
  });

  it("derives the signal endpoints and deployment attributes", () => {
    expect(
      getTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT:
          "https://otel-collector.example.com/",
        OTEL_EXPORTER_OTLP_HEADERS:
          "authorization=Bearer%20secret,x-tenant=tape",
        OTEL_SERVICE_NAME: "tape-test",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: "abc123",
      }),
    ).toEqual({
      headers: {
        authorization: "Bearer secret",
        "x-tenant": "tape",
      },
      logsEndpoint: "https://otel-collector.example.com/v1/logs",
      resourceAttributes: {
        "deployment.environment.name": "preview",
        "service.namespace": "tape",
        "service.version": "abc123",
      },
      serviceName: "tape-test",
      tracesEndpoint: "https://otel-collector.example.com/v1/traces",
    });
  });

  it("normalizes a signal specific endpoint without duplicating its path", () => {
    expect(
      normalizeOtlpEndpoint(
        "https://otel.example.com/collector/v1/logs?token=secret",
        "traces",
      ),
    ).toBe("https://otel.example.com/collector/v1/traces");
    expect(normalizeOtlpEndpoint("ftp://otel.example.com", "logs")).toBeNull();
  });

  it("ignores malformed OTLP header entries", () => {
    expect(parseOtlpHeaders("valid=one,broken,another=two=three")).toEqual({
      valid: "one",
      another: "two=three",
    });
  });
});

describe("telemetry sanitization", () => {
  it("removes route identifiers and query strings", () => {
    expect(
      sanitizeTelemetryRoute(
        "/meetings/11111111-1111-4111-8111-111111111111?token=secret",
      ),
    ).toBe("/meetings/:id");
  });

  it("redacts credentials and content fields", () => {
    expect(
      sanitizeTelemetryAttributes({
        authorization: "Bearer secret",
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcript: "private meeting words",
      }),
    ).toEqual({
      authorization: "[redacted]",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcript: "[redacted]",
    });
    expect(
      sanitizeTelemetryText(
        "alice@example.com failed at https://example.com/path?signature=secret Bearer abc123",
      ),
    ).toBe(
      "[redacted-email] failed at https://example.com/path Bearer [redacted]",
    );
  });
});
