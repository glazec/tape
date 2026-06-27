export const DEFAULT_ONESIGNAL_APP_ID =
  "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef";

export const ONESIGNAL_SERVICE_WORKER_PATH = "OneSignalSDKWorker.js";

export function getOneSignalAppId(
  source: Record<string, string | undefined> = process.env,
) {
  return (
    source.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim() || DEFAULT_ONESIGNAL_APP_ID
  );
}

export function buildOneSignalInitScript(appId: string) {
  return `
window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function(OneSignal) {
  await OneSignal.init({
    appId: ${JSON.stringify(appId)},
    serviceWorkerPath: ${JSON.stringify(ONESIGNAL_SERVICE_WORKER_PATH)},
    serviceWorkerParam: { scope: "/" }
  });
});
`;
}
