import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildScreenShareIntervals } from "@/lib/recall-screen-share";
import { analyzeStableVisualFrames } from "@/lib/video-frame-detection";
import {
  createVideoFrameFfmpegAdapter,
  type ProcessRunOptions,
} from "@/lib/video-frame-ffmpeg";

const ffmpegPath = resolveMediaBinary("FFMPEG_PATH", "ffmpeg");
const ffprobePath = resolveMediaBinary("FFPROBE_PATH", "ffprobe");
const trustedVideoUrl =
  "https://ap-northeast-1-recallai-production-bot-data.s3.amazonaws.com/generated.mp4";

describe(
  "generated frame extraction integration (requires ffmpeg and ffprobe)",
  () => {
    let directory: string;
    let videoPath: string;

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "meeting-video-frames-"));
      videoPath = join(directory, "presentation.mp4");
      generatePresentationVideo(videoPath);
    }, 30_000);

    afterAll(async () => {
      if (directory) {
        await rm(directory, { force: true, recursive: true });
      }
    });

    it("stores two source resolution slides without gallery or repeated states", async () => {
      const adapter = createVideoFrameFfmpegAdapter({
        env: { FFMPEG_PATH: ffmpegPath, FFPROBE_PATH: ffprobePath },
        runProcess: (binary, args, options) =>
          runLocalMediaProcess(binary, args, options, videoPath),
      });
      const durationMs = await adapter.probeVideoDurationMs(trustedVideoUrl);
      const intervals = buildScreenShareIntervals({
        durationMs,
        events: [
          {
            action: "screenshare_on",
            participant: { id: "presenter" },
            timestamp: { relative: 3 },
          },
          {
            action: "screenshare_off",
            participant: { id: "presenter" },
            timestamp: { relative: 13 },
          },
        ],
      });
      const samples = await adapter.sampleScreenShareFrames({
        intervals,
        videoUrl: trustedVideoUrl,
      });
      const timestamps = analyzeStableVisualFrames(samples, {
        requireInformativeSharedScreen: true,
      }).timestamps;

      expect(durationMs).toBe(13_000);
      expect(intervals).toEqual([{ startMs: 3_000, endMs: 13_000 }]);
      expect(timestamps).toEqual([5_000, 9_000]);

      for (const [index, timestampMs] of timestamps.entries()) {
        const jpeg = await adapter.extractJpegFrame({
          timestampMs,
          videoUrl: trustedVideoUrl,
        });
        const jpegPath = join(directory, `slide-${index}.jpg`);
        await writeFile(jpegPath, jpeg);

        expect(jpeg.length).toBeGreaterThan(20_000);
        expect(probeImageDimensions(jpegPath)).toEqual({
          height: 720,
          width: 1280,
        });
      }
    }, 30_000);
  },
);

function resolveMediaBinary(envName: string, binaryName: string) {
  const configuredPath = process.env[envName]?.trim();
  const candidates = [
    configuredPath,
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
  ];

  return (
    candidates.find((candidate) => candidate && existsSync(candidate)) ??
    binaryName
  );
}

function generatePresentationVideo(outputPath: string) {
  const slideA = "between(t,3,5.999)+between(t,10,12.999)";
  const result = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1280x720:r=30:d=13",
      "-vf",
      [
        "drawbox=x=0:y=0:w=640:h=360:color=0x3454D1:t=fill:enable='between(t,0,2.999)'",
        "drawbox=x=640:y=0:w=640:h=360:color=0xE84855:t=fill:enable='between(t,0,2.999)'",
        "drawbox=x=0:y=360:w=640:h=360:color=0x2D936C:t=fill:enable='between(t,0,2.999)'",
        "drawbox=x=640:y=360:w=640:h=360:color=0xF9C846:t=fill:enable='between(t,0,2.999)'",
        `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${slideA}'`,
        `drawbox=x=80:y=70:w=610:h=38:color=black:t=fill:enable='${slideA}'`,
        `drawgrid=width=18:height=10:thickness=1:color=0x333333:enable='${slideA}'`,
        `drawbox=x=80:y=240:w=930:h=24:color=0x3454D1:t=fill:enable='${slideA}'`,
        `drawbox=x=80:y=310:w=720:h=24:color=0x2D936C:t=fill:enable='${slideA}'`,
        "drawbox=x=0:y=0:w=iw:h=ih:color=0xEAF2F8:t=fill:enable='between(t,7,9.999)'",
        "drawbox=x=80:y=70:w=520:h=38:color=black:t=fill:enable='between(t,7,9.999)'",
        "drawgrid=width=22:height=12:thickness=1:color=0x333333:enable='between(t,7,9.999)'",
        "drawbox=x=80:y=245:w=300:h=300:color=0xE84855:t=fill:enable='between(t,7,9.999)'",
        "drawbox=x=430:y=245:w=300:h=220:color=0x3454D1:t=fill:enable='between(t,7,9.999)'",
        "drawbox=x=780:y=245:w=300:h=150:color=0x2D936C:t=fill:enable='between(t,7,9.999)'",
      ].join(","),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      outputPath,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`Unable to generate integration video: ${result.stderr}`);
  }
}

async function runLocalMediaProcess(
  binary: string,
  args: string[],
  options: ProcessRunOptions,
  videoPath: string,
): Promise<Uint8Array> {
  const remoteInputOptions = new Set([
    "-max_redirects",
    "-rw_timeout",
    "-tls_verify",
    "-verifyhost",
  ]);
  const localArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (remoteInputOptions.has(argument)) {
      index += 1;
      continue;
    }

    localArgs.push(argument === trustedVideoUrl ? videoPath : argument);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binary, localArgs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Integration media process timed out"));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (options.maxStdoutBytes && stdoutBytes > options.maxStdoutBytes) {
        child.kill("SIGKILL");
        reject(new Error("Integration media output was too large"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(new Uint8Array(Buffer.concat(stdout)));
      } else {
        reject(new Error(Buffer.concat(stderr).toString("utf8")));
      }
    });
  });
}

function probeImageDimensions(imagePath: string) {
  const result = spawnSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      imagePath,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`Unable to probe integration JPEG: ${result.stderr}`);
  }

  const output = JSON.parse(result.stdout) as {
    streams: Array<{ height: number; width: number }>;
  };
  return output.streams[0];
}
