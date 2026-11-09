// The SDK command resolves before media starts. Only the matching event proves
// capture is active and identifies whether shared media survives tab changes.
export async function startConfirmedRecording(sdk, config, timeoutMs = 20_000) {
  let finish;
  const confirmed = new Promise(resolve => { finish = resolve; });
  const onStarted = event => {
    if (event?.window?.id === config.windowId) finish({ rawMedia: event.rawMedia === true });
  };
  const onError = event => finish({ error: new Error(event?.message ?? "Meeting capture failed") });
  sdk.addEventListener("recording-started", onStarted);
  sdk.addEventListener("error", onError);
  const timer = setTimeout(() => finish({ error: new Error("Meeting capture did not confirm it started") }), timeoutMs);
  try {
    await sdk.startRecording(config);
    const result = await confirmed;
    if (result.error) throw result.error;
    return result;
  } finally {
    clearTimeout(timer);
    sdk.removeEventListener("recording-started", onStarted);
    sdk.removeEventListener("error", onError);
  }
}
