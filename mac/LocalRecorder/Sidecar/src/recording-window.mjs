// Match call identities, ignoring login/query parameters. Never use a title to
// associate one scheduled meeting with a different live call.
export function meetingIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "meet.google.com") {
      const code = url.pathname.match(/^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/)?.[1];
      return code ? `meet:${code}` : null;
    }
    if (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) {
      const id = url.pathname.match(/^\/(?:j|wc\/join)\/(\d{9,11})\/?$/)?.[1];
      return id ? `zoom:${id}` : null;
    }
  } catch { /* Unavailable or unsupported meeting URL. */ }
  return null;
}

export function createRecordingWindowSelector(sdk) {
  const windows = new Map();
  const update = (event) => {
    const window = event?.window;
    if (typeof window?.id === "string" && window.id) {
      windows.set(window.id, { ...windows.get(window.id), ...window });
    }
  };
  const closed = (event) => windows.delete(event?.window?.id);
  const listeners = [["meeting-detected", update], ["meeting-updated", update], ["meeting-closed", closed]];
  for (const [name, listener] of listeners) sdk.addEventListener(name, listener);

  return {
    async select({ timeoutMs = 5_000, expectedMeetingUrl } = {}) {
      try {
        // Allow discovery to report all calls and enrich their URLs. Picking the
        // first event can record the wrong meeting when two calls are open.
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
        const expected = meetingIdentity(expectedMeetingUrl);
        const candidates = [...windows.values()].filter((window) =>
          expectedMeetingUrl ? expected && meetingIdentity(window.url) === expected : true,
        );
        if (candidates.length === 1) {
          return { captureMode: "meeting", windowId: candidates[0].id };
        }
        throw new Error(candidates.length > 1
          ? "Multiple matching meetings are open. Choose a meeting window for local capture."
          : "No matching meeting window detected. Choose a meeting window for local capture.");
      } finally {
        for (const [name, listener] of listeners) sdk.removeEventListener(name, listener);
      }
    },
  };
}
