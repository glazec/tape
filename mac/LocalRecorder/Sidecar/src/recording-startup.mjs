// Cancellation may arrive while discovery or the native start operation awaits.
// Do not start after discovery was cancelled; if start is already in flight,
// wait for it and acknowledge stop before any replacement capture can start.
export function createRecordingStartup({ sdk, select, uploadToken, makeLifecycle, prepared, started }) {
  let cancelled = false;
  let lifecycle;
  let settled = false;
  return {
    get lifecycle() { return lifecycle; },
    async stop() {
      cancelled = true;
      if (settled) await lifecycle?.stop();
    },
    async run() {
      if (cancelled) return false;
      const selection = await select();
      if (cancelled) return false;
      lifecycle = makeLifecycle(selection.windowId);
      prepared(selection.windowId);
      try {
        await sdk.startRecording({ windowId: selection.windowId, uploadToken });
      } catch (error) {
        settled = true;
        // A rejected native call may still have allocated capture resources.
        // Failure to stop remains unacknowledged and must block replacement.
        await lifecycle.stop();
        throw error;
      }
      settled = true;
      started(selection, cancelled);
      if (cancelled) await lifecycle.stop();
      return true;
    },
  };
}
