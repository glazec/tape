// Startup failed before any capture existed. The SDK helper may already have
// exited, so its shutdown can reject or never settle; the parent must still
// learn that capture never started, or its Stop waits forever.
export async function abandonStartup({ sdk, send, exit, code, shutdownTimeoutMs = 5_000 }) {
  let timer;
  try {
    await Promise.race([
      sdk.shutdown(),
      new Promise(resolve => { timer = setTimeout(resolve, shutdownTimeoutMs); }),
    ]);
  } catch {
    // The helper is already gone; there is nothing left to shut down.
  } finally {
    clearTimeout(timer);
  }
  send({ type: "cancelled" });
  exit(code);
}
