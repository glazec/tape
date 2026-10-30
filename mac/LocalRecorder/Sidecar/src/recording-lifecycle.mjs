// Capturing and uploading are separate lifetimes. Only the parent, after a
// terminal server status, may request normal SDK shutdown.
export function createRecordingLifecycle({ sdk, send, windowId, exit }) {
  let stopped = false;
  let stopping;
  let shuttingDown;
  return {
    ended() { stopped = true; },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        if (!stopped) await sdk.stopRecording({ windowId });
        stopped = true;
        send({ type: "stopped", windowId });
      })().catch((error) => { stopping = undefined; throw error; });
      return stopping;
    },
    shutdown() {
      if (shuttingDown) return shuttingDown;
      shuttingDown = (async () => {
        if (!stopped) throw new Error("Capture must stop before shutdown");
        await sdk.shutdown();
        send({ type: "shutdown", windowId });
        exit(0);
      })();
      return shuttingDown;
    },
  };
}
