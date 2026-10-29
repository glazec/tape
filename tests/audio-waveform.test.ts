import { describe, expect, it, vi } from "vitest";
import { normalizeAudioPeaks, resampleAudioPeaks } from "@/lib/audio-waveform";
import { createAudioWaveformGenerator } from "@/lib/audio-waveform-server";

describe("audio waveform", () => {
  it("keeps silence small and makes loud sections visibly taller than quiet sections", () => {
    const samples = [0, 0.02, 0.2, 0.5].flatMap((level) =>
      Array(300).fill(level),
    );
    for (const count of [56, 120]) {
      const heights = normalizeAudioPeaks(
        resampleAudioPeaks(samples, count),
      ).map((level) => Math.round(2 + level * 27));
      expect(heights[0]).toBe(2);
      expect(heights[Math.floor(count * 0.3)]).toBeLessThan(5);
      expect(heights[Math.floor(count * 0.6)]).toBeGreaterThan(5);
      expect(heights[count - 1]).toBe(29);
    }
  });

  it("retains short bursts, the final sample, and tiny recordings", () => {
    expect(resampleAudioPeaks([0, 0, 0.8, 0, 0, 0, 0.4], 2)).toEqual([
      0.8, 0.4,
    ]);
    expect(resampleAudioPeaks([0.2], 3)).toEqual([0.2, 0.2, 0.2]);
    expect(normalizeAudioPeaks(Array(120).fill(0))).toEqual(Array(120).fill(0));
  });

  it("does not let a single click flatten ordinary speech", () => {
    const heights = normalizeAudioPeaks([...Array(119).fill(0.1), 1]);
    expect(heights[0]).toBe(1);
    expect(heights[119]).toBe(1);
  });

  it("preserves relative volume when almost all of a recording is silent", () => {
    const levels = normalizeAudioPeaks([...Array(118).fill(0), 0.05, 0.2]);
    expect(levels[0]).toBe(0);
    expect(levels[118]).toBeCloseTo(0.0625);
    expect(levels[119]).toBe(1);
  });

  it("extracts RMS windows and reuses the source cache across signed URL rotations", async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        new TextEncoder().encode(
          "lavfi.astats.Overall.RMS_level=-inf\nlavfi.astats.Overall.RMS_level=-40\nlavfi.astats.Overall.RMS_level=-20\nlavfi.astats.Overall.RMS_level=0\n",
        ),
      );
    const generate = createAudioWaveformGenerator(run);
    const peaks = await generate(
      "https://audio.example.com/file?token=one",
      "asset:1",
    );
    expect(peaks).toHaveLength(1200);
    expect(peaks[0]).toBe(0);
    expect(peaks[300]).toBeCloseTo(0.01);
    expect(peaks[600]).toBeCloseTo(0.1);
    expect(peaks[1199]).toBe(1);
    expect(
      await generate("https://audio.example.com/file?token=two", "asset:1"),
    ).toEqual(peaks);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][2]).toEqual({
      timeoutMs: 120_000,
      maxStdoutBytes: 16 * 1024 * 1024,
    });
    await generate("https://audio.example.com/replacement", "asset:2");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries failed work and rejects empty audio", async () => {
    const run = vi.fn().mockResolvedValue(new Uint8Array());
    const generate = createAudioWaveformGenerator(run);
    await expect(
      generate("https://audio.example.com/file", "asset"),
    ).rejects.toThrow("empty");
    await expect(
      generate("https://audio.example.com/file", "asset"),
    ).rejects.toThrow("empty");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent work and bounds decoder concurrency", async () => {
    let finish!: (data: Uint8Array) => void;
    const run = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    const generate = createAudioWaveformGenerator(run);
    const first = generate("https://audio.example.com/file", "one");
    const duplicate = generate("https://audio.example.com/file", "one");
    const finishFirst = finish;
    const second = generate("https://audio.example.com/file", "two");
    await expect(
      generate("https://audio.example.com/file", "three"),
    ).rejects.toThrow("busy");
    const output = new TextEncoder().encode(
      "lavfi.astats.Overall.RMS_level=-20\n",
    );
    finishFirst(output);
    finish(output);
    await Promise.all([first, duplicate, second]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
