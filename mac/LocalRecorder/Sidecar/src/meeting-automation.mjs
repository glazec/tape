// Called only by the dedicated settings action, never by recording startup.
export async function configureMeetingAutomation(sdk, permission, timeoutMs = 120_000) {
  if (!["browser-automation", "zoom-raw-media"].includes(permission)) {
    throw new Error("Unsupported meeting setup");
  }
  let finish;
  let requested = false;
  let initialized = false;
  const result = new Promise(resolve => { finish = resolve; });
  const onPermission = event => {
    if (requested && event?.permission === permission &&
        ["granted", "denied", "not_installed", "error"].includes(event.status)) finish(event.status);
  };
  sdk.addEventListener("permission-status", onPermission);
  const timer = setTimeout(() => finish("timeout"), timeoutMs);
  try {
    await sdk.init({ acquirePermissionsOnStartup: [], restartOnError: false });
    initialized = true;
    requested = true;
    await sdk.requestPermission(permission);
    return await result;
  } finally {
    clearTimeout(timer);
    sdk.removeEventListener("permission-status", onPermission);
    if (initialized) await sdk.shutdown();
  }
}
