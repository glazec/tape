// Tape's single service worker. OneSignal registers this same file at scope
// "/" for push on phones, and the app registers it for every visitor so the
// installed app has an offline screen and instant repeat loads.
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (error) {
  // Push stays unavailable when the CDN is blocked; offline support still works.
  console.warn("OneSignal service worker script unavailable", error);
}
importScripts("/tape-sw.js");
