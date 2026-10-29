import { existsSync } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProcessRunner,
  type ProcessRunner,
} from "@/lib/video-frame-ffmpeg";
import { resampleAudioPeaks } from "@/lib/audio-waveform";

export const AUDIO_WAVEFORM_FILTER =
  "aresample=16000,asetnsamples=n=1600:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-";
const MAX_AUDIO_BYTES = 256 * 1024 * 1024;

export function createAudioWaveformGenerator(
  runProcess: ProcessRunner,
  fetchAudio: typeof fetch = fetch,
) {
  const cache = new Map<
    string,
    { expires: number; result: Promise<number[]> }
  >();
  let running = 0;

  return async function generateAudioWaveform(
    audioUrl: string,
    sourceKey: string,
  ) {
    const cached = cache.get(sourceKey);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (running >= 2) throw new Error("Waveform generation is busy");

    const source = new URL(audioUrl);
    if (source.protocol !== "https:" || source.username || source.password) {
      throw new Error("Waveform requires an HTTPS audio source");
    }
    const bundledPath = "node_modules/ffmpeg-static/ffmpeg";
    const binary =
      process.env.FFMPEG_PATH?.trim() ||
      process.env.FFMPEG_BIN?.trim() ||
      (existsSync(bundledPath) ? bundledPath : "ffmpeg");
    running += 1;
    const result = (async () => {
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(tmpdir(), "tape-waveform-"));
        const path = join(directory, "audio");
        await downloadAudio(audioUrl, path, fetchAudio);
        const output = await runProcess(
          binary,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-threads",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "aac,aiff,amr,asf,au,flac,matroska,webm,mov,mp3,ogg,wav",
            "-i",
            path,
            "-map",
            "0:a:0",
            "-vn",
            "-filter_threads",
            "1",
            "-af",
            AUDIO_WAVEFORM_FILTER,
            "-f",
            "null",
            "-",
          ],
          { timeoutMs: 120_000, maxStdoutBytes: 16 * 1024 * 1024 },
        );
        const levels = [
          ...new TextDecoder()
            .decode(output)
            .matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?inf|[-\d.]+)/g),
        ].map((match) => {
          const decibels = Number(match[1]);
          return Number.isFinite(decibels)
            ? Math.min(1, 10 ** (decibels / 20))
            : 0;
        });
        if (!levels.length) throw new Error("Audio waveform is empty");
        return resampleAudioPeaks(levels, 1200);
      } finally {
        running -= 1;
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    })().catch((error) => {
      cache.delete(sourceKey);
      throw error;
    });
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(sourceKey, { expires: Date.now() + 10 * 60_000, result });
    return result;
  };
}

async function downloadAudio(
  audioUrl: string,
  path: string,
  fetchAudio: typeof fetch,
) {
  const response = await fetchAudio(audioUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES
  ) {
    await response.body?.cancel();
    throw new Error("Audio download unavailable or too large");
  }
  const file = await open(path, "wx", 0o600);
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES)
        throw new Error("Audio download is too large");
      await file.writeFile(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await file.close();
  }
}

export const generateAudioWaveform = createAudioWaveformGenerator(
  createProcessRunner(),
);
