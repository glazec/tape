"use client";

import * as amplitude from "@amplitude/unified";

type AmplitudeWindow = Window & {
  __tapeAmplitudeInitialization?: Promise<void>;
};

export function captureAmplitudeClientEvent(
  event: string,
  properties: Record<string, unknown>,
) {
  afterAmplitudeInitialization(() => {
    amplitude.track(event, properties);
  });
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

function afterAmplitudeInitialization(action: () => void) {
  const initialization = (window as AmplitudeWindow)
    .__tapeAmplitudeInitialization;

  if (!initialization) {
    return;
  }

  void initialization.then(action).catch(() => undefined);
}
