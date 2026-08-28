"use client";

import * as Sentry from "@sentry/nextjs";

type ClientObservabilityFailure = {
  phase: "delivery" | "initialization";
  provider: "amplitude" | "browser_telemetry";
  reason: "exception" | "rejected";
  statusCode?: number;
};

const SESSION_STORAGE_PREFIX = "tape.observability.failure";
const reportedFailures = new Set<string>();

export function captureClientObservabilityFailure({
  phase,
  provider,
  reason,
  statusCode,
}: ClientObservabilityFailure) {
  const failureKey = `${provider}.${phase}`;

  if (wasFailureReported(failureKey)) {
    return;
  }

  try {
    Sentry.captureMessage("client.observability.failure", {
      level: "warning",
      tags: {
        "observability.failure_reason": reason,
        "observability.phase": phase,
        "observability.provider": provider,
        ...(statusCode !== undefined
          ? { "observability.status_code": String(statusCode) }
          : {}),
      },
    });
  } catch {
    // Reporting failures must not affect the product workflow.
  }
}

function wasFailureReported(failureKey: string) {
  if (reportedFailures.has(failureKey)) {
    return true;
  }

  const storageKey = `${SESSION_STORAGE_PREFIX}.${failureKey}`;

  try {
    if (sessionStorage.getItem(storageKey)) {
      reportedFailures.add(failureKey);
      return true;
    }

    sessionStorage.setItem(storageKey, "1");
  } catch {
    // The in-memory guard still bounds reports when storage is unavailable.
  }

  reportedFailures.add(failureKey);
  return false;
}
