const DEFAULT_ONESIGNAL_APP_ID =
  "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef";

const ONESIGNAL_SERVICE_WORKER_PATH = "OneSignalSDKWorker.js";
const ONESIGNAL_MOBILE_MEDIA_QUERY = "(hover: none) and (pointer: coarse)";
const DEFAULT_ONESIGNAL_ALLOWED_ORIGINS = [
  "https://meeting-note-swart.vercel.app",
];

export function getOneSignalAppId(
  source: Record<string, string | undefined> = process.env,
) {
  return (
    source.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim() || DEFAULT_ONESIGNAL_APP_ID
  );
}

export function getOneSignalAllowedOrigins(
  source: Record<string, string | undefined> = process.env,
) {
  const configuredOrigins =
    source.NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS?.trim();

  if (!configuredOrigins) {
    return DEFAULT_ONESIGNAL_ALLOWED_ORIGINS;
  }

  return configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);
}

export function buildOneSignalInitScript(
  appId: string,
  allowedOrigins = DEFAULT_ONESIGNAL_ALLOWED_ORIGINS,
) {
  return `
	window.OneSignalDeferred = window.OneSignalDeferred || [];
	if (!window.MeetingNoteOneSignalReady) {
	  window.MeetingNoteOneSignalReady = new Promise((resolve) => {
	    const allowedOrigins = ${JSON.stringify(allowedOrigins)};
	    function isMeetingNoteMobileDevice() {
	      const mobileMedia = window.matchMedia?.(${JSON.stringify(
          ONESIGNAL_MOBILE_MEDIA_QUERY,
        )})?.matches === true;
	      const mobileUserAgent = /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);

	      return mobileMedia || mobileUserAgent;
	    }

	    if (!allowedOrigins.includes(window.location.origin) || !isMeetingNoteMobileDevice()) {
	      resolve(null);
	      return;
	    }

	    OneSignalDeferred.push(async function(OneSignal) {
	      try {
	        await OneSignal.init({
	          appId: ${JSON.stringify(appId)},
	          serviceWorkerPath: ${JSON.stringify(ONESIGNAL_SERVICE_WORKER_PATH)},
	          serviceWorkerParam: { scope: "/" }
	        });
	        resolve(OneSignal);
	      } catch (error) {
	        console.warn("OneSignal initialization failed", error);
	        resolve(null);
	      }
	    });
	  });
	}
	`;
}
