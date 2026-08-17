import { captureAmplitudeClientEvent } from "@/lib/amplitude/client";
import {
  sanitizeTelemetryRoute,
  sanitizeTelemetryText,
} from "@/lib/telemetry/sanitize";

export type ClientTelemetryEvent = {
  action?: string;
  destinationRoute?: string;
  durationMs?: number;
  errorMessage?: string;
  errorName?: string;
  errorStack?: string;
  navigationType?: "push" | "replace" | "traverse";
  occurredAt: string;
  route: string;
  sessionId: string;
  targetType?: string;
  testSessionId?: string;
  type:
    | "client_error"
    | "navigation_start"
    | "page_load"
    | "page_view"
    | "unhandled_rejection"
    | "user_action";
};

type TapeTelemetryWindow = Window & {
  __tapeTelemetryInitialized?: boolean;
};

const FLUSH_DELAY_MS = 2_000;
const MAX_BATCH_SIZE = 10;
const SESSION_STORAGE_KEY = "tape.telemetry.session";
export const TEST_SESSION_STORAGE_KEY =
  "tape.telemetry.test_session";
const queue: ClientTelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function initializeClientTelemetry() {
  const telemetryWindow = window as TapeTelemetryWindow;

  if (telemetryWindow.__tapeTelemetryInitialized) {
    return;
  }

  telemetryWindow.__tapeTelemetryInitialized = true;
  enqueueClientTelemetry({ type: "page_view" });
  window.addEventListener("error", captureWindowError);
  window.addEventListener("unhandledrejection", captureUnhandledRejection);
  document.addEventListener("click", captureUserAction, true);
  document.addEventListener("visibilitychange", flushWhenHidden);

  if (document.readyState === "complete") {
    queueMicrotask(capturePageLoad);
  } else {
    window.addEventListener("load", capturePageLoad, { once: true });
  }
}

export function captureNavigationStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  enqueueClientTelemetry({
    navigationType,
    route: sanitizeTelemetryRoute(url),
    type: "navigation_start",
  });
}

export function enqueueClientTelemetry(
  event: Pick<ClientTelemetryEvent, "type"> &
    Partial<Omit<ClientTelemetryEvent, "type">>,
) {
  const queuedEvent: ClientTelemetryEvent = {
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    route:
      event.route ?? sanitizeTelemetryRoute(window.location.pathname),
    sessionId: event.sessionId ?? getTelemetrySessionId(),
    testSessionId:
      event.testSessionId ?? getTelemetryTestSessionId(),
  };
  queue.push(queuedEvent);
  captureAmplitudeClientEvent(`tape_${queuedEvent.type}`, {
    ...(queuedEvent.action ? { action: queuedEvent.action } : {}),
    ...(queuedEvent.destinationRoute
      ? { destination_route: queuedEvent.destinationRoute }
      : {}),
    ...(queuedEvent.durationMs !== undefined
      ? { duration_ms: queuedEvent.durationMs }
      : {}),
    ...(queuedEvent.errorName ? { error_name: queuedEvent.errorName } : {}),
    ...(queuedEvent.navigationType
      ? { navigation_type: queuedEvent.navigationType }
      : {}),
    route: queuedEvent.route,
    telemetry_session_id: queuedEvent.sessionId,
    ...(queuedEvent.targetType ? { target_type: queuedEvent.targetType } : {}),
  });

  if (queue.length >= MAX_BATCH_SIZE) {
    void flushClientTelemetry();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushClientTelemetry();
    }, FLUSH_DELAY_MS);
  }
}

export function captureClientAction(action: string) {
  captureAmplitudeClientEvent("tape_product_action", {
    action,
    route: sanitizeTelemetryRoute(window.location.pathname),
  });
}

export async function flushClientTelemetry(useBeacon = false) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const events = queue.splice(0, MAX_BATCH_SIZE);

  if (events.length === 0) {
    return;
  }

  const body = JSON.stringify({ events });

  try {
    if (useBeacon && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(
        "/api/telemetry/events",
        new Blob([body], { type: "application/json" }),
      );

      if (accepted) {
        return;
      }
    }

    await fetch("/api/telemetry/events", {
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  } catch {
    // Observability must not affect the user workflow.
  }
}

function captureWindowError(event: ErrorEvent) {
  enqueueClientTelemetry({
    errorMessage: sanitizeTelemetryText(event.message),
    errorName: event.error instanceof Error ? event.error.name : "Error",
    errorStack:
      event.error instanceof Error && event.error.stack
        ? sanitizeTelemetryText(event.error.stack, 4_000)
        : undefined,
    type: "client_error",
  });
}

function captureUnhandledRejection(event: PromiseRejectionEvent) {
  const reason = event.reason;

  enqueueClientTelemetry({
    errorMessage: sanitizeTelemetryText(
      reason instanceof Error ? reason.message : reason,
    ),
    errorName: reason instanceof Error ? reason.name : "UnhandledRejection",
    errorStack:
      reason instanceof Error && reason.stack
        ? sanitizeTelemetryText(reason.stack, 4_000)
        : undefined,
    type: "unhandled_rejection",
  });
}

function captureUserAction(event: MouseEvent) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const target = event.target.closest<HTMLElement>(
    "a[href], button, [role='button'], [data-telemetry-action]",
  );

  if (!target) {
    return;
  }

  const configuredAction = target.dataset.telemetryAction
    ?.toLowerCase()
    .replace(/[^a-z0-9_.]/gu, "_")
    .slice(0, 64);
  const targetType =
    target instanceof HTMLAnchorElement
      ? "link"
      : target.tagName.toLowerCase() === "button"
        ? "button"
        : target.getAttribute("role") || "action";

  enqueueClientTelemetry({
    action: configuredAction || targetType,
    destinationRoute:
      target instanceof HTMLAnchorElement
        ? getSameOriginRoute(target.href)
        : undefined,
    targetType,
    type: "user_action",
  });
}

function capturePageLoad() {
  const navigation = performance.getEntriesByType(
    "navigation",
  )[0] as PerformanceNavigationTiming | undefined;

  enqueueClientTelemetry({
    durationMs: navigation
      ? Math.max(0, Math.round(navigation.duration))
      : undefined,
    type: "page_load",
  });
}

function flushWhenHidden() {
  if (document.visibilityState === "hidden") {
    void flushClientTelemetry(true);
  }
}

function getSameOriginRoute(value: string) {
  try {
    const url = new URL(value);
    return url.origin === window.location.origin
      ? sanitizeTelemetryRoute(url.pathname)
      : undefined;
  } catch {
    return undefined;
  }
}

function getTelemetrySessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (existing) {
      return existing;
    }

    const sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    return sessionId;
  } catch {
    return crypto.randomUUID();
  }
}

function getTelemetryTestSessionId() {
  try {
    const testSessionId = sessionStorage.getItem(
      TEST_SESSION_STORAGE_KEY,
    );

    return testSessionId && isUuid(testSessionId)
      ? testSessionId
      : undefined;
  } catch {
    return undefined;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
