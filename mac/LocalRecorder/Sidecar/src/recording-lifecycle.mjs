// Capturing and uploading are separate lifetimes. Only the parent, after a
// terminal server status, may request normal SDK shutdown.
export function createRecordingLifecycle({ sdk, send, windowId, exit }) {
  let stopped = false;
  let helperGone = false;
  let stopping;
  let shuttingDown;
  return {
    ended() { stopped = true; },
    // The SDK's native helper exited (crash or normal close). Capture cannot
    // continue, and every SDK command now rejects, so stop and shutdown must
    // finish without it instead of leaving the parent's Stop unanswered.
    helperExited() { stopped = true; helperGone = true; },
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
        if (!helperGone) await sdk.shutdown();
        send({ type: "shutdown", windowId });
        exit(0);
      })().catch((error) => { shuttingDown = undefined; throw error; });
      return shuttingDown;
    },
  };
}
