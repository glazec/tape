export type GrayscaleFrame = {
  pixels: Uint8Array;
  timestampMs: number;
};

const CHANGE_MEAN_THRESHOLD = 3;
const CHANGE_PIXEL_RATIO_THRESHOLD = 0.008;
const PIXEL_DELTA_THRESHOLD = 20;
const STABLE_MEAN_THRESHOLD = 1.5;
const STABLE_PIXEL_RATIO_THRESHOLD = 0.005;
const STABLE_DURATION_MS = 2_000;

type FrameComparison = {
  changedPixelRatio: number;
  meanAbsoluteDifference: number;
};

export function compareGrayscaleFrames(
  left: Uint8Array,
  right: Uint8Array,
): FrameComparison {
  if (left.length === 0 || right.length === 0) {
    throw new Error("Grayscale frames must not be empty");
  }
  if (left.length !== right.length) {
    throw new Error("Grayscale frames must have equal pixel lengths");
  }

  let changedPixelCount = 0;
  let absoluteDifferenceSum = 0;

  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs(left[index] - right[index]);
    absoluteDifferenceSum += delta;
    if (delta >= PIXEL_DELTA_THRESHOLD) {
      changedPixelCount += 1;
    }
  }

  return {
    changedPixelRatio: changedPixelCount / left.length,
    meanAbsoluteDifference: absoluteDifferenceSum / left.length,
  };
}

function isVisualChange(comparison: FrameComparison): boolean {
  return (
    comparison.meanAbsoluteDifference >= CHANGE_MEAN_THRESHOLD ||
    comparison.changedPixelRatio >= CHANGE_PIXEL_RATIO_THRESHOLD
  );
}

function isStable(comparison: FrameComparison): boolean {
  return (
    comparison.meanAbsoluteDifference <= STABLE_MEAN_THRESHOLD &&
    comparison.changedPixelRatio <= STABLE_PIXEL_RATIO_THRESHOLD
  );
}

export function selectStableVisualFrames(frames: GrayscaleFrame[]): number[] {
  if (frames.length === 0) {
    return [];
  }

  const pixelCount = frames[0].pixels.length;
  let previousTimestampMs = -1;

  for (const frame of frames) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0) {
      throw new Error("Frame timestamps must be finite and nonnegative");
    }
    if (frame.timestampMs < previousTimestampMs) {
      throw new Error("Frame timestamps must be monotonic");
    }
    if (frame.pixels.length === 0 || frame.pixels.length !== pixelCount) {
      throw new Error("Frames must have equal, nonempty pixel dimensions");
    }
    previousTimestampMs = frame.timestampMs;
  }

  const acceptedTimestamps: number[] = [];
  const acceptedStates: Uint8Array[] = [];
  let candidate = frames[0];
  let candidateEvaluated = false;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const comparison = compareGrayscaleFrames(candidate.pixels, frame.pixels);

    if (isVisualChange(comparison)) {
      candidate = frame;
      candidateEvaluated = false;
      continue;
    }

    if (
      candidateEvaluated ||
      !isStable(comparison) ||
      frame.timestampMs - candidate.timestampMs < STABLE_DURATION_MS
    ) {
      continue;
    }

    candidateEvaluated = true;
    const repeatsAcceptedState = acceptedStates.some((acceptedState) =>
      isStable(compareGrayscaleFrames(candidate.pixels, acceptedState)),
    );

    if (!repeatsAcceptedState) {
      acceptedStates.push(candidate.pixels);
      acceptedTimestamps.push(frame.timestampMs);
    }
  }

  return acceptedTimestamps;
}
