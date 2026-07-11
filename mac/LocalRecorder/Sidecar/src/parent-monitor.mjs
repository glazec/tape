import process from "node:process";

export function startParentProcessMonitor({
  intervalMs = 1_000,
  onParentExit,
  parentPid,
  processApi = process,
}) {
  let finished = false;
  const timer = setInterval(() => {
    if (finished) return;

    try {
      processApi.kill(parentPid, 0);
    } catch {
      finished = true;
      clearInterval(timer);
      onParentExit();
    }
  }, intervalMs);

  timer.unref?.();

  return () => {
    finished = true;
    clearInterval(timer);
  };
}
