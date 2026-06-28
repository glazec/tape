"use client";

import { useEffect } from "react";

type OneSignalSdk = {
  login?: (externalId: string) => Promise<void> | void;
};

declare global {
  interface Window {
    MeetingNoteOneSignalReady?: Promise<OneSignalSdk | null>;
    OneSignalDeferred?: Array<(oneSignal: OneSignalSdk) => Promise<void> | void>;
  }
}

type OneSignalLoginProps = {
  allowedOrigins?: string[];
  externalId: string;
};

export function OneSignalLogin({
  allowedOrigins = [],
  externalId,
}: OneSignalLoginProps) {
  const allowedOriginsKey = allowedOrigins.join("\n");

  useEffect(() => {
    if (!externalId) {
      return;
    }

    const currentOriginIsAllowed = allowedOriginsKey
      .split("\n")
      .includes(window.location.origin);
    if (!currentOriginIsAllowed) {
      return;
    }

    void window.MeetingNoteOneSignalReady?.then(async (oneSignal) => {
      try {
        await oneSignal?.login?.(externalId);
      } catch (error) {
        console.warn("OneSignal login failed", error);
      }
    });
  }, [allowedOriginsKey, externalId]);

  return null;
}
