import { describe, expect, it } from "vitest";

import {
  compareGrayscaleFrames,
  selectStableVisualFrames,
  type GrayscaleFrame,
} from "@/lib/video-frame-detection";

const WIDTH = 160;
const HEIGHT = 90;
const PIXEL_COUNT = WIDTH * HEIGHT;

function pixels(value: number): Uint8Array {
  return new Uint8Array(PIXEL_COUNT).fill(value);
}

function frame(value: number, timestampMs: number): GrayscaleFrame {
  return { pixels: pixels(value), timestampMs };
}

function changedFrame(
  value: number,
  timestampMs: number,
  changedPixelCount: number,
  delta = 255 - value,
): GrayscaleFrame {
  const data = pixels(value);
  data.fill(value + delta, 0, changedPixelCount);
  return { pixels: data, timestampMs };
}

describe("compareGrayscaleFrames", () => {
  it("calculates changed pixel ratio and mean absolute difference", () => {
    const left = pixels(0);
    const right = pixels(0);
    right[0] = 19;
    right[1] = 20;

    expect(compareGrayscaleFrames(left, right)).toEqual({
      changedPixelRatio: 1 / PIXEL_COUNT,
      meanAbsoluteDifference: 39 / PIXEL_COUNT,
    });
  });

  it("counts a pixel changed at the exact delta threshold", () => {
    const left = pixels(50);
    const right = pixels(50);
    right[0] = 69;
    right[1] = 70;

    expect(compareGrayscaleFrames(left, right).changedPixelRatio).toBe(
      1 / PIXEL_COUNT,
    );
  });

  it("throws for empty or unequal pixel arrays", () => {
    expect(() =>
      compareGrayscaleFrames(new Uint8Array(), new Uint8Array()),
    ).toThrow();
    expect(() =>
      compareGrayscaleFrames(new Uint8Array(1), new Uint8Array(2)),
    ).toThrow();
  });
});

describe("selectStableVisualFrames", () => {
  it("selects unique stable states at the samples that prove stability", () => {
    const frames = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      frame(50, 3_000),
      frame(100, 4_000),
      frame(100, 5_000),
      frame(100, 6_000),
      frame(0, 7_000),
      frame(0, 8_000),
      frame(0, 9_000),
    ];

    expect(selectStableVisualFrames(frames)).toEqual([2_000, 6_000]);
  });

  it("resets stability when a frame is unstable but not a visual change", () => {
    const frames = [frame(0, 0), frame(2, 1_000), frame(0, 2_000)];

    expect(selectStableVisualFrames(frames)).toEqual([]);
  });

  it("ignores cursor sized changes", () => {
    const frames = [
      frame(0, 0),
      changedFrame(0, 1_000, 50),
      frame(0, 2_000),
    ];

    expect(selectStableVisualFrames(frames)).toEqual([2_000]);
  });

  it("accepts a persistent bullet reveal", () => {
    const frames = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      changedFrame(0, 3_000, 200),
      changedFrame(0, 4_000, 200),
      changedFrame(0, 5_000, 200),
    ];

    expect(selectStableVisualFrames(frames)).toEqual([2_000, 5_000]);
  });

  it("retains more than 40 unique stable states", () => {
    const frames: GrayscaleFrame[] = [];

    for (let state = 0; state < 41; state += 1) {
      const startMs = state * 3_000;
      frames.push(
        frame(state * 4, startMs),
        frame(state * 4, startMs + 1_000),
        frame(state * 4, startMs + 2_000),
      );
    }

    expect(selectStableVisualFrames(frames)).toEqual(
      Array.from({ length: 41 }, (_, index) => index * 3_000 + 2_000),
    );
  });

  it("rejects continuously changing frames", () => {
    const frames = Array.from({ length: 20 }, (_, index) =>
      frame(index * 3, index * 1_000),
    );

    expect(selectStableVisualFrames(frames)).toEqual([]);
  });

  it("does not treat a timestamp gap as continuous stability", () => {
    expect(
      selectStableVisualFrames([frame(0, 0), frame(0, 10_000)]),
    ).toEqual([]);
  });

  it("rejects a repeated nonadjacent slide", () => {
    const frames = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      frame(100, 3_000),
      frame(100, 4_000),
      frame(100, 5_000),
      frame(200, 6_000),
      frame(200, 7_000),
      frame(200, 8_000),
      frame(0, 9_000),
      frame(0, 10_000),
      frame(0, 11_000),
    ];

    expect(selectStableVisualFrames(frames)).toEqual([2_000, 5_000, 8_000]);
  });

  it("detects changes from a repeated current stable state", () => {
    const frames = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      frame(100, 3_000),
      frame(100, 4_000),
      frame(100, 5_000),
      frame(0, 6_000),
      frame(0, 7_000),
      frame(0, 8_000),
      frame(102, 9_000),
      frame(102, 10_000),
      frame(102, 11_000),
    ];

    expect(selectStableVisualFrames(frames)).toEqual([2_000, 5_000, 11_000]);
  });

  it("treats the exact mean change threshold as a visual change", () => {
    const atThreshold = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      frame(3, 3_000),
      frame(3, 4_000),
      frame(3, 5_000),
    ];
    const belowThreshold = atThreshold.map((item, index) =>
      index < 3 ? item : frame(2, item.timestampMs),
    );

    expect(selectStableVisualFrames(atThreshold)).toEqual([2_000, 5_000]);
    expect(selectStableVisualFrames(belowThreshold)).toEqual([2_000]);
  });

  it("applies the changed pixel ratio threshold at its pixel boundary", () => {
    const withChangedPixels = (changedPixelCount: number) => [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      changedFrame(0, 3_000, changedPixelCount),
      changedFrame(0, 4_000, changedPixelCount),
      changedFrame(0, 5_000, changedPixelCount),
    ];

    expect(selectStableVisualFrames(withChangedPixels(115))).toEqual([2_000]);
    expect(selectStableVisualFrames(withChangedPixels(116))).toEqual([
      2_000, 5_000,
    ]);
  });

  it("accepts exact stability thresholds after exactly two seconds", () => {
    const exactMeanProof = pixels(100);
    exactMeanProof.fill(101, 0, PIXEL_COUNT / 2);
    exactMeanProof.fill(102, PIXEL_COUNT / 2);

    const exactRatioProof = pixels(200);
    exactRatioProof.fill(220, 0, 72);

    const meanFrames = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      frame(100, 3_000),
      { pixels: exactMeanProof, timestampMs: 4_000 },
      { pixels: exactMeanProof, timestampMs: 5_000 },
    ];
    const ratioFrames = [
      frame(0, 0),
      frame(0, 1_000),
      frame(0, 2_000),
      frame(200, 3_000),
      { pixels: exactRatioProof, timestampMs: 4_000 },
      { pixels: exactRatioProof, timestampMs: 5_000 },
    ];

    expect(selectStableVisualFrames(meanFrames)).toEqual([2_000, 5_000]);
    expect(selectStableVisualFrames(ratioFrames)).toEqual([2_000, 5_000]);
  });

  it("rejects a candidate above either stability threshold", () => {
    const aboveMeanProof = pixels(100);
    aboveMeanProof.fill(101, 0, PIXEL_COUNT / 2 - 1);
    aboveMeanProof.fill(102, PIXEL_COUNT / 2 - 1);

    const aboveRatioProof = pixels(200);
    aboveRatioProof.fill(220, 0, 73);

    expect(
      selectStableVisualFrames([
        frame(0, 0),
        frame(0, 1_000),
        frame(0, 2_000),
        frame(100, 3_000),
        { pixels: aboveMeanProof, timestampMs: 5_000 },
      ]),
    ).toEqual([2_000]);
    expect(
      selectStableVisualFrames([
        frame(0, 0),
        frame(0, 1_000),
        frame(0, 2_000),
        frame(200, 3_000),
        { pixels: aboveRatioProof, timestampMs: 5_000 },
      ]),
    ).toEqual([2_000]);
  });

  it("throws for invalid timestamps", () => {
    for (const timestampMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => selectStableVisualFrames([frame(0, timestampMs)])).toThrow();
    }
  });

  it("throws for nonmonotonic timestamps", () => {
    expect(() =>
      selectStableVisualFrames([frame(0, 1_000), frame(0, 0)]),
    ).toThrow();
  });

  it("throws for empty or inconsistent frame dimensions", () => {
    expect(() =>
      selectStableVisualFrames([
        { pixels: new Uint8Array(), timestampMs: 0 },
      ]),
    ).toThrow();
    expect(() =>
      selectStableVisualFrames([
        frame(0, 0),
        { pixels: new Uint8Array(PIXEL_COUNT - 1), timestampMs: 1_000 },
      ]),
    ).toThrow();
  });
});
