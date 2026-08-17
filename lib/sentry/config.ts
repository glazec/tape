import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

import {
  sanitizeTelemetryAttributes,
  sanitizeTelemetryRoute,
  sanitizeTelemetryText,
} from "@/lib/telemetry/sanitize";

type SentryInitOptions = Parameters<
  typeof import("@sentry/nextjs").init
>[0];
type SentryLog = Parameters<
  NonNullable<SentryInitOptions["beforeSendLog"]>
>[0];

type SentryRuntimeConfigInput = {
  development: boolean;
  dsn?: string;
  environment?: string;
};

export const sentryDataCollection = {
  cookies: false,
  databaseQueryData: false,
  frameContextLines: 0,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
  httpBodies: [],
  httpHeaders: { request: false, response: false },
  stackFrameVariables: false,
  urlQueryParams: false,
  userInfo: false,
} satisfies NonNullable<SentryInitOptions["dataCollection"]>;

export function getSentryInitOptions({
  development,
  dsn: rawDsn,
  environment: rawEnvironment,
}: SentryRuntimeConfigInput) {
  const dsn = rawDsn?.trim() || undefined;
  const environment =
    rawEnvironment?.trim() || (development ? "development" : "production");

  return {
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSend: sanitizeSentryEvent,
    beforeSendLog: sanitizeSentryLog,
    dataCollection: sentryDataCollection,
    dsn,
    enabled: Boolean(dsn),
    enableLogs: true,
    environment,
    sampleRate: 1,
    sendDefaultPii: false,
    tracesSampleRate: development ? 1 : 0.1,
  } satisfies SentryInitOptions;
}

export function sanitizeSentryBreadcrumb(
  breadcrumb: Breadcrumb,
): Breadcrumb | null {
  if (
    breadcrumb.category === "console" ||
    breadcrumb.category?.startsWith("ui.")
  ) {
    return null;
  }

  return {
    ...breadcrumb,
    data: breadcrumb.data
      ? sanitizeTelemetryAttributes(breadcrumb.data)
      : undefined,
    message: breadcrumb.message
      ? sanitizeTelemetryText(breadcrumb.message)
      : undefined,
  };
}

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  return {
    ...event,
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map((value) => ({
            ...value,
            value: value.value
              ? sanitizeTelemetryText(value.value)
              : value.value,
          })),
        }
      : undefined,
    extra: undefined,
    message: event.message
      ? sanitizeTelemetryText(event.message)
      : undefined,
    request: event.request
      ? {
          method: event.request.method,
          url: event.request.url
            ? sanitizeSentryUrl(event.request.url)
            : undefined,
        }
      : undefined,
    transaction: event.transaction
      ? sanitizeTelemetryRoute(event.transaction)
      : undefined,
    user: undefined,
  };
}

export function sanitizeSentryLog(log: SentryLog): SentryLog {
  return {
    ...log,
    attributes: log.attributes
      ? sanitizeTelemetryAttributes(log.attributes)
      : undefined,
    message: sanitizeTelemetryText(log.message),
  };
}

export function sanitizeSentryUrl(value: string) {
  try {
    const url = new URL(value, "https://tape.invalid");
    const route = sanitizeTelemetryRoute(url.pathname);

    return url.origin === "https://tape.invalid"
      ? route
      : `${url.origin}${route}`;
  } catch {
    return "/";
  }
}
