export type TelemetryErrorContext = {
  errorType: string;
  fingerprint: string;
  handled: boolean;
  operation: string;
  source: "browser" | "inngest" | "nextjs" | "server";
};

export function createTelemetryErrorContext(input: {
  error: unknown;
  errorType?: string;
  eventName: string;
  handled: boolean;
  operation: string;
  scope?: string;
  source: TelemetryErrorContext["source"];
}): TelemetryErrorContext {
  const errorType =
    input.errorType?.trim().slice(0, 120) ||
    getTelemetryErrorType(input.error);

  return {
    errorType,
    fingerprint: [
      input.eventName,
      input.operation,
      input.scope,
      errorType,
    ]
      .filter((part): part is string => Boolean(part))
      .map(normalizeFingerprintPart)
      .filter(Boolean)
      .join(":")
      .slice(0, 255),
    handled: input.handled,
    operation: input.operation,
    source: input.source,
  };
}

export function getTelemetryErrorAttributes(
  context: TelemetryErrorContext,
): Record<string, boolean | string> {
  return {
    "error.fingerprint": context.fingerprint,
    "error.handled": context.handled,
    "error.type": context.errorType,
    "operation.name": context.operation,
    "telemetry.source": context.source,
  };
}

export function isTelemetryErrorContext(
  value: unknown,
): value is TelemetryErrorContext {
  if (!value || typeof value !== "object") {
    return false;
  }

  const context = value as Record<string, unknown>;

  return (
    typeof context.errorType === "string" &&
    typeof context.fingerprint === "string" &&
    typeof context.handled === "boolean" &&
    typeof context.operation === "string" &&
    typeof context.source === "string"
  );
}

function getTelemetryErrorType(error: unknown) {
  if (error instanceof Error && error.name.trim()) {
    return error.name.trim().slice(0, 120);
  }

  return typeof error === "string" ? "Error" : "UnknownError";
}

function normalizeFingerprintPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 96);
}
