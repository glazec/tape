"use client";

import { useEffect } from "react";

type OneSignalSdk = {
  login?: (externalId: string) => Promise<void> | void;
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(oneSignal: OneSignalSdk) => Promise<void> | void>;
  }
}

export function OneSignalLogin({ externalId }: { externalId: string }) {
  useEffect(() => {
    if (!externalId) {
      return;
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (oneSignal) => {
      await oneSignal.login?.(externalId);
    });
  }, [externalId]);

  return null;
}
