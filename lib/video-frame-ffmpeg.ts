import { spawn } from "node:child_process";
import { BlockList, isIP } from "node:net";
import { basename } from "node:path";

import type { ScreenShareInterval } from "@/lib/recall-screen-share";
import type { GrayscaleFrame } from "@/lib/video-frame-detection";

const FRAME_BYTE_LENGTH = 160 * 90;
const STDERR_CHARACTER_LIMIT = 4_000;
const RESTRICTED_IP_ADDRESSES = createRestrictedIpBlockList();

export type ProcessRunner = (
  binary: string,
  args: string[],
) => Promise<Uint8Array>;

type BinaryEnvironment = Partial<
  Record<"FFMPEG_PATH" | "FFPROBE_PATH", string>
>;

type AdapterDependencies = {
  env?: BinaryEnvironment;
  runProcess: ProcessRunner;
};

export function createVideoFrameFfmpegAdapter({
  env,
  runProcess,
}: AdapterDependencies) {
  const binaryEnvironment = env ?? (process.env as BinaryEnvironment);

  async function probeVideoDurationMs(videoUrl: string): Promise<number> {
    assertSafeVideoUrl(videoUrl);
    const stdout = await runProcess(
      getBinaryPath(binaryEnvironment.FFPROBE_PATH, "ffprobe"),
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        videoUrl,
      ],
    );

    return parseDurationMs(stdout);
  }

  async function sampleScreenShareFrames(input: {
    intervals: ScreenShareInterval[];
    videoUrl: string;
  }): Promise<GrayscaleFrame[]> {
    assertSafeVideoUrl(input.videoUrl);
    const frames: GrayscaleFrame[] = [];

    for (const interval of input.intervals) {
      const stdout = await runProcess(
        getBinaryPath(binaryEnvironment.FFMPEG_PATH, "ffmpeg"),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          formatSeconds(interval.startMs),
          "-t",
          formatSeconds(interval.endMs - interval.startMs),
          "-i",
          input.videoUrl,
          "-an",
          "-vf",
          "fps=1,scale=160:90,format=gray",
          "-pix_fmt",
          "gray",
          "-f",
          "rawvideo",
          "pipe:1",
        ],
      );

      if (stdout.length % FRAME_BYTE_LENGTH !== 0) {
        throw new Error("ffmpeg returned an incomplete raw video frame");
      }

      const frameCount = stdout.length / FRAME_BYTE_LENGTH;

      for (let index = 0; index < frameCount; index += 1) {
        const timestampMs = interval.startMs + index * 1_000;

        if (timestampMs > interval.endMs) {
          continue;
        }

        const offset = index * FRAME_BYTE_LENGTH;
        frames.push({
          pixels: stdout.slice(offset, offset + FRAME_BYTE_LENGTH),
          timestampMs,
        });
      }
    }

    return frames;
  }

  async function extractJpegFrame(input: {
    timestampMs: number;
    videoUrl: string;
  }): Promise<Uint8Array> {
    assertSafeVideoUrl(input.videoUrl);

    if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
      throw new Error("Frame timestamp must be finite and nonnegative");
    }

    const stdout = await runProcess(
      getBinaryPath(binaryEnvironment.FFMPEG_PATH, "ffmpeg"),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        formatSeconds(input.timestampMs),
        "-i",
        input.videoUrl,
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
    );

    if (stdout.length === 0) {
      throw new Error("ffmpeg returned an empty JPEG frame");
    }

    return stdout;
  }

  return {
    extractJpegFrame,
    probeVideoDurationMs,
    sampleScreenShareFrames,
  };
}

const defaultAdapter = createVideoFrameFfmpegAdapter({
  runProcess: runProcessWithSpawn,
});

export async function probeVideoDurationMs(videoUrl: string): Promise<number> {
  return defaultAdapter.probeVideoDurationMs(videoUrl);
}

export async function sampleScreenShareFrames(input: {
  intervals: ScreenShareInterval[];
  videoUrl: string;
}): Promise<GrayscaleFrame[]> {
  return defaultAdapter.sampleScreenShareFrames(input);
}

export async function extractJpegFrame(input: {
  timestampMs: number;
  videoUrl: string;
}): Promise<Uint8Array> {
  return defaultAdapter.extractJpegFrame(input);
}

function runProcessWithSpawn(binary: string, args: string[]) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(
        -STDERR_CHARACTER_LIMIT,
      );
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start ${basename(binary)}: ${redactUrls(error.message)}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(new Uint8Array(Buffer.concat(stdoutChunks)));
        return;
      }

      const detail = redactUrls(stderr.trim());
      reject(
        new Error(
          `${basename(binary)} exited with code ${code}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });
}

function getBinaryPath(override: string | undefined, fallback: string) {
  return override?.trim() || fallback;
}

function formatSeconds(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3);
}

function parseDurationMs(stdout: Uint8Array) {
  let output: unknown;

  try {
    output = JSON.parse(new TextDecoder().decode(stdout));
  } catch {
    throw new Error("ffprobe returned an invalid video duration");
  }

  const format = getRecord(output)?.format;
  const rawDuration = getRecord(format)?.duration;

  if (typeof rawDuration !== "string" && typeof rawDuration !== "number") {
    throw new Error("ffprobe returned an invalid video duration");
  }

  const duration = Number(rawDuration);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("ffprobe returned an invalid video duration");
  }

  return Math.round(duration * 1_000);
}

function assertSafeVideoUrl(videoUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(videoUrl);
  } catch {
    throw new Error("Video URL must be a valid public HTTPS URL");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error("Video URL must be a valid public HTTPS URL");
  }

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();

  if (
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isRestrictedIpAddress(hostname)
  ) {
    throw new Error("Video URL must use a public hostname");
  }
}

function isRestrictedIpAddress(hostname: string) {
  const address = hostname.split("%", 1)[0];
  const version = isIP(address);

  if (version === 0) {
    return false;
  }

  return RESTRICTED_IP_ADDRESSES.check(
    address,
    version === 4 ? "ipv4" : "ipv6",
  );
}

function createRestrictedIpBlockList() {
  const blockList = new BlockList();
  const ipv4Subnets: Array<[string, number]> = [
    ["10.0.0.0", 8],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
  ];
  const ipv4CompatibleIpv6Subnets: Array<[string, number]> = [
    ["::a00:0", 104],
    ["::7f00:0", 104],
    ["::a9fe:0", 112],
    ["::ac10:0", 108],
    ["::c0a8:0", 112],
  ];

  for (const [network, prefix] of ipv4Subnets) {
    blockList.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of ipv4CompatibleIpv6Subnets) {
    blockList.addSubnet(network, prefix, "ipv6");
  }

  blockList.addAddress("::1", "ipv6");
  blockList.addSubnet("fc00::", 7, "ipv6");
  blockList.addSubnet("fe80::", 10, "ipv6");

  return blockList;
}

function redactUrls(value: string) {
  return value.replace(/https:\/\/[^\s"'<>]+/gi, "[redacted URL]");
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
