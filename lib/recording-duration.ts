export const MAX_RECORDING_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeRecordingDurationMs(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_RECORDING_DURATION_MS
    ? Math.round(value)
    : undefined;
}

export async function readMediaFileDurationMs(file: File) {
  if (
    typeof document === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return undefined;
  }

  const media = document.createElement(
    file.type.toLowerCase().startsWith("video/") ? "video" : "audio",
  );
  const objectUrl = URL.createObjectURL(file);

  try {
    return await new Promise<number | undefined>((resolve) => {
      const finish = (value?: number) => {
        window.clearTimeout(timeout);
        media.onloadedmetadata = null;
        media.onerror = null;
        media.removeAttribute("src");
        media.load();
        resolve(normalizeRecordingDurationMs(value));
      };
      const timeout = window.setTimeout(() => finish(), 10_000);

      media.preload = "metadata";
      media.onloadedmetadata = () => finish(media.duration * 1000);
      media.onerror = () => finish();
      media.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function waitForRecordingDurationMs(
  pendingDuration: Promise<number | undefined> | null,
  timeoutMs = 1_500,
) {
  if (!pendingDuration) {
    return undefined;
  }

  let timeout: number | undefined;

  try {
    return await Promise.race([
      pendingDuration,
      new Promise<undefined>((resolve) => {
        timeout = window.setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
  }
}
