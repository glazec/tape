const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NUMERIC_SEGMENT = /^\d{4,}$/u;
const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|email|password|secret|token|transcript|content|meetingtitle|meetingurl)/iu;

export function sanitizeTelemetryRoute(value: string) {
  try {
    const url = new URL(value, "https://tape.invalid");
    const segments = url.pathname.split("/").map((segment) => {
      if (UUID_SEGMENT.test(segment) || NUMERIC_SEGMENT.test(segment)) {
        return ":id";
      }

      return segment;
    });

    return segments.join("/").slice(0, 240) || "/";
  } catch {
    return "/";
  }
}

export function sanitizeTelemetryText(
  value: unknown,
  maximumLength = 2_000,
) {
  return String(value)
    .replace(
      /https?:\/\/[^\s"'<>]+/giu,
      (candidate) => sanitizeTelemetryUrl(candidate),
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      "[redacted-email]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      "[redacted-jwt]",
    )
    .slice(0, maximumLength);
}

export function sanitizeTelemetryAttributes(
  attributes: Record<string, unknown>,
): AnyValueMap {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      sanitizeTelemetryValue(key, value),
    ]),
  );
}

function sanitizeTelemetryValue(key: string, value: unknown): AnyValue {
  if (SENSITIVE_KEY.test(key)) {
    return "[redacted]";
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeTelemetryText(value, 1_000);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((entry) => sanitizeTelemetryValue(key, entry));
  }

  if (value instanceof Error) {
    return {
      message: sanitizeTelemetryText(value.message),
      name: value.name,
      stack: value.stack
        ? sanitizeTelemetryText(value.stack, 4_000)
        : undefined,
    };
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([childKey, childValue]) => [
          childKey,
          sanitizeTelemetryValue(childKey, childValue),
        ]),
    );
  }

  return sanitizeTelemetryText(value);
}

function sanitizeTelemetryUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${sanitizeTelemetryRoute(url.pathname)}`;
  } catch {
    return "[redacted-url]";
  }
}
import type { AnyValue, AnyValueMap } from "@opentelemetry/api-logs";
