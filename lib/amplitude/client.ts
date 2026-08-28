"use client";

import * as amplitude from "@amplitude/unified";

import { captureClientObservabilityFailure } from "@/lib/sentry/client-diagnostics";

type AmplitudeWindow = Window & {
  __tapeAmplitudeInitialization?: Promise<void>;
};

export function captureAmplitudeClientEvent(
  event: string,
  properties: Record<string, unknown>,
) {
  afterAmplitudeInitialization(() => amplitude.track(event, properties));
}

export function identifyAmplitudeUser(userId: string, teamId?: string) {
  if (!userId) {
    return;
  }

  afterAmplitudeInitialization(() => {
    amplitude.setUserId(userId);
    if (teamId) {
      amplitude.setGroup("workspace_id", teamId);
    }
  });
}

export function resetAmplitudeUser() {
  afterAmplitudeInitialization(() => {
    amplitude.reset();
  });
}

type AmplitudeActionResult =
  | { promise: Promise<{ code?: number }> }
  | undefined
  | void;

function afterAmplitudeInitialization(
  action: () => AmplitudeActionResult,
) {
  const initialization = (window as AmplitudeWindow)
    .__tapeAmplitudeInitialization;

  if (!initialization) {
    return;
  }

  void initialization
    .then(() => {
      let result: AmplitudeActionResult;

      try {
        result = action();
      } catch {
        captureAmplitudeFailure("delivery", "exception");
        return;
      }

      if (!result) {
        return;
      }

      void result.promise
        .then((deliveryResult) => {
          if (
            typeof deliveryResult.code === "number" &&
            (deliveryResult.code < 200 || deliveryResult.code >= 300)
          ) {
            captureAmplitudeFailure(
              "delivery",
              "rejected",
              deliveryResult.code,
            );
          }
        })
        .catch(() => captureAmplitudeFailure("delivery", "exception"));
    })
    .catch(() => captureAmplitudeFailure("initialization", "exception"));
}

export function captureAmplitudeInitializationFailure() {
  captureAmplitudeFailure("initialization", "exception");
}

function captureAmplitudeFailure(
  phase: "delivery" | "initialization",
  reason: "exception" | "rejected",
  statusCode?: number,
) {
  captureClientObservabilityFailure({
    phase,
    provider: "amplitude",
    reason,
    statusCode,
  });
}
