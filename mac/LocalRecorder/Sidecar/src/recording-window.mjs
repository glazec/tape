export function createRecordingWindowSelector(sdk) {
  let resolveDetectedWindow;
  const detectedWindow = new Promise((resolve) => {
    resolveDetectedWindow = resolve;
  });
  const listener = (event) => {
    const windowId = event?.window?.id;

    if (typeof windowId === "string" && windowId) {
      resolveDetectedWindow(windowId);
    }
  };

  sdk.addEventListener("meeting-detected", listener);

  return {
    async select({ timeoutMs = 5_000 } = {}) {
      let timeout;
      const timeoutReached = new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      });
      const meetingWindowId = await Promise.race([
        detectedWindow,
        timeoutReached,
      ]);

      clearTimeout(timeout);
      sdk.removeEventListener("meeting-detected", listener);

      if (meetingWindowId) {
        return { captureMode: "meeting", windowId: meetingWindowId };
      }

      throw new Error("No meeting window detected. Choose a meeting window for local capture.");
    },
  };
}
