import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  type LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  OTLPHttpJsonTraceExporter,
  registerOTel,
} from "@vercel/otel";

import { getTelemetryConfig } from "@/lib/telemetry/config";
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
  __tapeTelemetryState?: TelemetryState;
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
      exporter: new OTLPLogExporter({
        headers: config.headers,
        url: config.logsEndpoint,
      }),
      maxExportBatchSize: 128,
      scheduledDelayMillis: 1_000,
    });

    registerOTel({
      attributes: config.resourceAttributes,
      logRecordProcessors: [processor],
      serviceName: config.serviceName,
      traceExporter: new OTLPHttpJsonTraceExporter({
        headers: config.headers,
        url: config.tracesEndpoint,
      }),
    });

    telemetryGlobal.__tapeTelemetryState = {
      emitting: false,
      flushing: false,
      logger: logs.getLogger("tape", "1.0.0"),
      processor,
    };
    instrumentConsole();

    return true;
  } catch {
    return false;
  }
}

export function isServerTelemetryEnabled() {
  return Boolean(telemetryGlobal.__tapeTelemetryState);
}

export function emitTelemetryLog(input: {
  attributes?: Record<string, unknown>;
  error?: unknown;
  eventName: string;
  severity?: TelemetrySeverity;
  timestamp?: Date;
}) {
  const state = telemetryGlobal.__tapeTelemetryState;

  if (!state) {
    return false;
  }

  if (state.emitting) {
    return false;
  }

  state.emitting = true;
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

  if (!state || state.flushing) {
    return;
  }

  state.flushing = true;
  try {
    await state.processor.forceFlush();
  } catch {
    // Telemetry must never change the product request outcome.
  } finally {
    state.flushing = false;
  }
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

        emitTelemetryLog({
          attributes:
            metadata.length > 0
              ? { "log.arguments": JSON.stringify(
                  sanitizeTelemetryAttributes({ metadata }),
                ) }
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
