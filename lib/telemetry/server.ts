import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import * as Sentry from "@sentry/nextjs";
import {
  OTLPHttpJsonTraceExporter,
  registerOTel,
} from "@vercel/otel";

import { getTelemetryConfig } from "@/lib/telemetry/config";
import {
  getTelemetryErrorAttributes,
  isTelemetryErrorContext,
} from "@/lib/telemetry/error-context";
import {
  sanitizeTelemetryAttributes,
  sanitizeTelemetryText,
} from "@/lib/telemetry/sanitize";

type ConsoleLevel = "debug" | "error" | "info" | "log" | "warn";
type TelemetrySeverity = "DEBUG" | "ERROR" | "INFO" | "WARN";

type TelemetryState = {
  emitting: boolean;
  flushing: boolean;
  logger: ReturnType<typeof logs.getLogger>;
  processor: LogRecordProcessor;
};

type TapeTelemetryGlobal = typeof globalThis & {
  __tapeTelemetryFailures?: Set<string>;
  __tapeTelemetryState?: TelemetryState;
  __tapeTelemetryTraceProcessor?: SpanProcessor;
};

const telemetryGlobal = globalThis as TapeTelemetryGlobal;

const severityNumbers = {
  DEBUG: SeverityNumber.DEBUG,
  ERROR: SeverityNumber.ERROR,
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
} satisfies Record<TelemetrySeverity, SeverityNumber>;

export function registerServerTelemetry(options?: {
  defaultServiceName?: string;
  tracingOwner?: "sentry" | "standalone";
}) {
  if (telemetryGlobal.__tapeTelemetryState) {
    return true;
  }

  const config = getTelemetryConfig(
    process.env,
    options?.defaultServiceName,
  );

  if (!config) {
    return false;
  }

  try {
    const processor = new BatchLogRecordProcessor({
      exporter: new ReportingLogExporter({
        headers: config.headers,
        url: config.logsEndpoint,
      }),
      maxExportBatchSize: 128,
      scheduledDelayMillis: 1_000,
    });

    if (options?.tracingOwner === "sentry") {
      const loggerProvider = new LoggerProvider({
        processors: [processor],
        resource: resourceFromAttributes({
          ...config.resourceAttributes,
          "service.name": config.serviceName,
        }),
      });

      if (logs.setGlobalLoggerProvider(loggerProvider) !== loggerProvider) {
        throw new Error("OpenTelemetry logger provider is already registered");
      }
    } else {
      registerOTel({
        attributes: config.resourceAttributes,
        logRecordProcessors: [processor],
        serviceName: config.serviceName,
        traceExporter: new ReportingTraceExporter({
          headers: config.headers,
          url: config.tracesEndpoint,
        }),
      });
    }

    telemetryGlobal.__tapeTelemetryState = {
      emitting: false,
      flushing: false,
      logger: logs.getLogger("tape", "1.0.0"),
      processor,
    };
    instrumentConsole();

    return true;
  } catch (error) {
    reportTelemetryFailureOnce("registration", error);
    return false;
  }
}

export function createServerTraceProcessor(options?: {
  defaultServiceName?: string;
}) {
  if (telemetryGlobal.__tapeTelemetryTraceProcessor) {
    return telemetryGlobal.__tapeTelemetryTraceProcessor;
  }

  const config = getTelemetryConfig(
    process.env,
    options?.defaultServiceName,
  );

  if (!config) {
    return null;
  }

  try {
    if (!process.env.OTEL_SERVICE_NAME?.trim()) {
      process.env.OTEL_SERVICE_NAME = config.serviceName;
    }
    mergeOtelResourceAttributes(config.resourceAttributes);
    const processor = new BatchSpanProcessor(
      new ReportingTraceExporter({
        headers: config.headers,
        url: config.tracesEndpoint,
      }),
    );
    telemetryGlobal.__tapeTelemetryTraceProcessor = processor;
    return processor;
  } catch (error) {
    reportTelemetryFailureOnce("trace_registration", error);
    return null;
  }
}

function mergeOtelResourceAttributes(
  resourceAttributes: Record<string, string>,
) {
  const existing = process.env.OTEL_RESOURCE_ATTRIBUTES?.trim();
  const existingKeys = new Set(
    existing
      ?.split(",")
      .flatMap((pair) => {
        const separator = pair.indexOf("=");
        return separator > 0 ? [pair.slice(0, separator).trim()] : [];
      })
      .filter(Boolean) ?? [],
  );
  const additions = Object.entries(resourceAttributes)
    .filter(([key]) => !existingKeys.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);

  process.env.OTEL_RESOURCE_ATTRIBUTES = [existing, ...additions]
    .filter(Boolean)
    .join(",");
}

export function isServerTelemetryEnabled() {
  return Boolean(telemetryGlobal.__tapeTelemetryState || Sentry.isEnabled());
}

export function emitTelemetryLog(input: {
  attributes?: Record<string, unknown>;
  error?: unknown;
  eventName: string;
  severity?: TelemetrySeverity;
  timestamp?: Date;
}) {
  const state = telemetryGlobal.__tapeTelemetryState;
  const severity = input.severity ?? "INFO";
  const attributes = sanitizeTelemetryAttributes(input.attributes ?? {});

  if (input.error instanceof Error) {
    attributes["exception.type"] = input.error.name;
    attributes["exception.message"] = sanitizeTelemetryText(
      input.error.message,
    );
    if (input.error.stack) {
      attributes["exception.stacktrace"] = sanitizeTelemetryText(
        input.error.stack,
        4_000,
      );
    }
  } else if (input.error !== undefined) {
    attributes["exception.message"] = sanitizeTelemetryText(input.error);
  }

  const sentryEmitted = emitSentryLog(
    input.eventName,
    severity,
    attributes,
  );

  if (!state || state.emitting) {
    return sentryEmitted;
  }

  state.emitting = true;

  try {
    state.logger.emit({
      attributes,
      body: input.eventName,
      eventName: input.eventName,
      severityNumber: severityNumbers[severity],
      severityText: severity,
      timestamp: input.timestamp,
    });
  } finally {
    state.emitting = false;
  }

  return true;
}

export async function flushTelemetry() {
  const state = telemetryGlobal.__tapeTelemetryState;

  if (state?.flushing) {
    return;
  }

  if (state) {
    state.flushing = true;
  }

  try {
    const operations = [
      ...(state
        ? [
            {
              promise: state.processor.forceFlush(),
              stage: "log_flush",
            },
          ]
        : []),
      ...(Sentry.isEnabled()
        ? [
            {
              promise: Sentry.flush(2_000),
              stage: "sentry_flush",
            },
          ]
        : []),
    ];
    const results = await Promise.allSettled(
      operations.map(({ promise }) => promise),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        reportTelemetryFailureOnce(
          operations[index]?.stage ?? "flush",
          result.reason,
        );
      } else if (
        operations[index]?.stage === "sentry_flush" &&
        result.value === false
      ) {
        reportTelemetryFailureOnce(
          "sentry_flush",
          new Error("Sentry flush did not complete"),
        );
      }
    });
  } catch (error) {
    reportTelemetryFailureOnce("flush", error);
  } finally {
    if (state) {
      state.flushing = false;
    }
  }
}

class ReportingLogExporter extends OTLPLogExporter {
  override export(
    records: Parameters<OTLPLogExporter["export"]>[0],
    callback: Parameters<OTLPLogExporter["export"]>[1],
  ) {
    try {
      super.export(records, (result) => {
        if (result.code !== 0) {
          reportTelemetryFailureOnce("log_export", result.error);
        }
        callback(result);
      });
    } catch (error) {
      reportTelemetryFailureOnce("log_export", error);
      throw error;
    }
  }
}

class ReportingTraceExporter extends OTLPHttpJsonTraceExporter {
  override export(
    spans: Parameters<OTLPHttpJsonTraceExporter["export"]>[0],
    callback: Parameters<OTLPHttpJsonTraceExporter["export"]>[1],
  ) {
    try {
      super.export(spans, (result) => {
        if (result.code !== 0) {
          reportTelemetryFailureOnce("trace_export", result.error);
        }
        callback(result);
      });
    } catch (error) {
      reportTelemetryFailureOnce("trace_export", error);
      throw error;
    }
  }
}

function reportTelemetryFailureOnce(stage: string, error: unknown) {
  const failures =
    telemetryGlobal.__tapeTelemetryFailures ??= new Set<string>();

  if (failures.has(stage)) {
    return;
  }

  failures.add(stage);

  try {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error ?? "unknown"));
    process.stderr.write(
      `${JSON.stringify({
        error: sanitizeTelemetryText(normalizedError.message, 1_000),
        errorType: normalizedError.name,
        eventName: "telemetry.pipeline.failure",
        stage,
      })}\n`,
    );
  } catch {
    // Telemetry failure reporting must never change the request outcome.
  }
}

function emitSentryLog(
  eventName: string,
  severity: TelemetrySeverity,
  attributes: Record<string, unknown>,
) {
  if (!Sentry.isEnabled()) {
    return false;
  }

  if (severity === "ERROR") {
    Sentry.logger.error(eventName, attributes);
  } else if (severity === "WARN") {
    Sentry.logger.warn(eventName, attributes);
  } else if (severity === "DEBUG") {
    Sentry.logger.debug(eventName, attributes);
  } else {
    Sentry.logger.info(eventName, attributes);
  }

  return true;
}

function instrumentConsole() {
  const originalConsole = {
    debug: console.debug.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
  };

  for (const level of Object.keys(originalConsole) as ConsoleLevel[]) {
    console[level] = (...args: unknown[]) => {
      originalConsole[level](...args);

      try {
        const firstArgument = args[0];
        const eventName =
          typeof firstArgument === "string" &&
          /^[a-z][a-z0-9_.-]{0,127}$/u.test(firstArgument)
            ? firstArgument
            : `console.${level}`;
        const metadata = args.slice(
          eventName === firstArgument ? 1 : 0,
        );
        const structuredAttributes =
          getStructuredConsoleAttributes(metadata);

        emitTelemetryLog({
          attributes:
            metadata.length > 0
              ? {
                  ...structuredAttributes,
                  "log.arguments": JSON.stringify(
                    sanitizeTelemetryAttributes({ metadata }),
                  ),
                }
              : undefined,
          error: metadata.find((argument) => argument instanceof Error),
          eventName,
          severity: consoleSeverity(level),
        });

        if (level === "error") {
          void flushTelemetry();
        }
      } catch {
        // Keep the original console behavior if serialization fails.
      }
    };
  }
}

function getStructuredConsoleAttributes(metadata: unknown[]) {
  const attributes: Record<string, unknown> = {};

  for (const value of metadata) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const record = value as Record<string, unknown>;

    if (isTelemetryErrorContext(record.telemetry)) {
      Object.assign(
        attributes,
        getTelemetryErrorAttributes(record.telemetry),
      );

      if (typeof record.errorMessage === "string") {
        attributes["error.message"] = sanitizeTelemetryText(
          record.errorMessage,
        );
      }
    }
  }

  return attributes;
}

function consoleSeverity(level: ConsoleLevel): TelemetrySeverity {
  if (level === "error") {
    return "ERROR";
  }

  if (level === "warn") {
    return "WARN";
  }

  if (level === "debug") {
    return "DEBUG";
  }

  return "INFO";
}
