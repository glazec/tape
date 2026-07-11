import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVideoFrameFfmpegAdapter,
  extractJpegFrame,
  type ProcessRunner,
} from "@/lib/video-frame-ffmpeg";

const FRAME_BYTE_LENGTH = 160 * 90;
const VIDEO_URL =
  "https://recall-public.s3.amazonaws.com/video.mp4?X-Amz-Signature=secret";

function rawFrames(values: number[]): Uint8Array {
  const output = new Uint8Array(values.length * FRAME_BYTE_LENGTH);

  values.forEach((value, index) => {
    output.fill(
      value,
      index * FRAME_BYTE_LENGTH,
      (index + 1) * FRAME_BYTE_LENGTH,
    );
  });

  return output;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sampleScreenShareFrames", () => {
  it("passes exact sampling arguments with input seeking before the URL", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const runProcess: ProcessRunner = async (binary, args) => {
      calls.push({ binary, args });
      return new Uint8Array();
    };
    const adapter = createVideoFrameFfmpegAdapter({
      env: { FFMPEG_PATH: "/custom/ffmpeg" },
      runProcess,
    });

    await adapter.sampleScreenShareFrames({
      intervals: [{ startMs: 10_000, endMs: 30_000 }],
      videoUrl: VIDEO_URL,
    });

    expect(calls).toEqual([
      {
        binary: "/custom/ffmpeg",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          "10.000",
          "-t",
          "20.000",
          "-i",
          VIDEO_URL,
          "-an",
          "-vf",
          "fps=1,scale=160:90,format=gray",
          "-pix_fmt",
          "gray",
          "-f",
          "rawvideo",
          "pipe:1",
        ],
      },
    ]);
  });

  it("splits raw frames, timestamps them, and preserves interval order", async () => {
    const outputs = [rawFrames([1, 2, 3, 4]), rawFrames([5, 6])];
    const adapter = createVideoFrameFfmpegAdapter({
      runProcess: async () => outputs.shift() ?? new Uint8Array(),
    });

    const frames = await adapter.sampleScreenShareFrames({
      intervals: [
        { startMs: 10_000, endMs: 12_500 },
        { startMs: 20_000, endMs: 21_000 },
      ],
      videoUrl: VIDEO_URL,
    });

    expect(frames.map((frame) => frame.timestampMs)).toEqual([
      10_000, 11_000, 12_000, 20_000, 21_000,
    ]);
    expect(frames.map((frame) => frame.pixels[0])).toEqual([1, 2, 3, 5, 6]);
    expect(frames.every((frame) => frame.pixels.length === FRAME_BYTE_LENGTH)).toBe(
      true,
    );
  });

  it("rejects trailing incomplete raw frame bytes", async () => {
    const adapter = createVideoFrameFfmpegAdapter({
      runProcess: async () => new Uint8Array(FRAME_BYTE_LENGTH + 1),
    });

    await expect(
      adapter.sampleScreenShareFrames({
        intervals: [{ startMs: 0, endMs: 2_000 }],
        videoUrl: VIDEO_URL,
      }),
    ).rejects.toThrow(/incomplete/i);
  });
});

describe("extractJpegFrame", () => {
  it("seeks before input and requests a full resolution high quality JPEG", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const adapter = createVideoFrameFfmpegAdapter({
      env: { FFMPEG_PATH: "/custom/ffmpeg" },
      runProcess: async (binary, args) => {
        calls.push({ binary, args });
        return jpeg;
      },
    });

    await expect(
      adapter.extractJpegFrame({ timestampMs: 12_000, videoUrl: VIDEO_URL }),
    ).resolves.toEqual(jpeg);

    expect(calls).toEqual([
      {
        binary: "/custom/ffmpeg",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          "12.000",
          "-i",
          VIDEO_URL,
          "-an",
          "-frames:v",
          "1",
          "-q:v",
          "2",
          "-pix_fmt",
          "yuvj444p",
          "-vcodec",
          "mjpeg",
          "-f",
          "image2pipe",
          "pipe:1",
        ],
      },
    ]);
    expect(calls[0].args.join(" ")).not.toContain("scale");
    expect(calls[0].args.indexOf("-ss")).toBeLessThan(
      calls[0].args.indexOf("-i"),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects invalid timestamp %s before spawning",
    async (timestampMs) => {
      const runProcess = vi.fn<ProcessRunner>();
      const adapter = createVideoFrameFfmpegAdapter({ runProcess });

      await expect(
        adapter.extractJpegFrame({ timestampMs, videoUrl: VIDEO_URL }),
      ).rejects.toThrow(/timestamp/i);
      expect(runProcess).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty JPEG", async () => {
    const adapter = createVideoFrameFfmpegAdapter({
      runProcess: async () => new Uint8Array(),
    });

    await expect(
      adapter.extractJpegFrame({ timestampMs: 0, videoUrl: VIDEO_URL }),
    ).rejects.toThrow(/empty/i);
  });
});

describe("probeVideoDurationMs", () => {
  it("passes exact ffprobe arguments and rounds duration to milliseconds", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const adapter = createVideoFrameFfmpegAdapter({
      env: { FFPROBE_PATH: "/custom/ffprobe" },
      runProcess: async (binary, args) => {
        calls.push({ binary, args });
        return new TextEncoder().encode('{"format":{"duration":"12.3456"}}');
      },
    });

    await expect(adapter.probeVideoDurationMs(VIDEO_URL)).resolves.toBe(12_346);
    expect(calls).toEqual([
      {
        binary: "/custom/ffprobe",
        args: [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          VIDEO_URL,
        ],
      },
    ]);
  });

  it.each([
    "not json",
    "{}",
    '{"format":{"duration":"nope"}}',
    '{"format":{"duration":true}}',
    '{"format":{"duration":"0"}}',
    '{"format":{"duration":"-1"}}',
  ])("rejects malformed or nonpositive output: %s", async (stdout) => {
    const adapter = createVideoFrameFfmpegAdapter({
      runProcess: async () => new TextEncoder().encode(stdout),
    });

    await expect(adapter.probeVideoDurationMs(VIDEO_URL)).rejects.toThrow(
      /duration/i,
    );
  });
});

describe("video URL validation", () => {
  it.each([
    "http://example.com/video.mp4",
    "https://user:password@example.com/video.mp4",
    "https://localhost/video.mp4",
    "https://worker.localhost/video.mp4",
    "https://127.0.0.1/video.mp4",
    "https://10.2.3.4/video.mp4",
    "https://172.16.0.1/video.mp4",
    "https://192.168.1.1/video.mp4",
    "https://169.254.2.3/video.mp4",
    "https://[::1]/video.mp4",
    "https://[fc00::1]/video.mp4",
    "https://[fe80::1]/video.mp4",
    "https://[::ffff:127.0.0.1]/video.mp4",
  ])("rejects unsafe URL before spawning: %s", async (videoUrl) => {
    const runProcess = vi.fn<ProcessRunner>();
    const adapter = createVideoFrameFfmpegAdapter({ runProcess });

    await expect(adapter.probeVideoDurationMs(videoUrl)).rejects.toThrow(
      /video URL/i,
    );
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("accepts a signed public S3 HTTPS URL", async () => {
    const runProcess = vi.fn<ProcessRunner>(async () =>
      new TextEncoder().encode('{"format":{"duration":"1"}}'),
    );
    const adapter = createVideoFrameFfmpegAdapter({ runProcess });

    await expect(adapter.probeVideoDurationMs(VIDEO_URL)).resolves.toBe(1_000);
    expect(runProcess).toHaveBeenCalledOnce();
  });

  it("falls back to ffprobe and ffmpeg binary names", async () => {
    const binaries: string[] = [];
    const adapter = createVideoFrameFfmpegAdapter({
      env: {},
      runProcess: async (binary) => {
        binaries.push(binary);
        return binary === "ffprobe"
          ? new TextEncoder().encode('{"format":{"duration":"1"}}')
          : new Uint8Array();
      },
    });

    await adapter.probeVideoDurationMs(VIDEO_URL);
    await adapter.sampleScreenShareFrames({
      intervals: [{ startMs: 0, endMs: 1_000 }],
      videoUrl: VIDEO_URL,
    });

    expect(binaries).toEqual(["ffprobe", "ffmpeg"]);
  });
});

describe("default process runner", () => {
  it("rejects spawn failures without exposing the signed URL", async () => {
    vi.stubEnv("FFMPEG_PATH", "/path/that/does/not/exist/ffmpeg");

    const error = await extractJpegFrame({
      timestampMs: 0,
      videoUrl: VIDEO_URL,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("X-Amz-Signature");
  });

  it("retains bounded stderr on nonzero exit and redacts signed URLs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "video-frame-ffmpeg-"));
    const executable = join(directory, "fake-ffmpeg");
    await writeFile(
      executable,
      [
        "#!/usr/bin/env node",
        'process.stderr.write("x".repeat(4100));',
        'process.stderr.write(" " + process.argv.find((arg) => arg.startsWith("https://")));',
        "process.exit(9);",
      ].join("\n"),
    );
    await chmod(executable, 0o755);
    vi.stubEnv("FFMPEG_PATH", executable);

    try {
      const error = await extractJpegFrame({
        timestampMs: 0,
        videoUrl: VIDEO_URL,
      }).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("code 9");
      expect((error as Error).message).toContain("[redacted URL]");
      expect((error as Error).message).not.toContain("X-Amz-Signature");
      expect((error as Error).message.length).toBeLessThan(4_100);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
