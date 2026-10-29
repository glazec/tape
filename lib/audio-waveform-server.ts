import { existsSync } from "node:fs";
import {
  createProcessRunner,
  type ProcessRunner,
} from "@/lib/video-frame-ffmpeg";
import { resampleAudioPeaks } from "@/lib/audio-waveform";

export const AUDIO_WAVEFORM_FILTER =
  "aresample=16000,asetnsamples=n=1600:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-";

export function createAudioWaveformGenerator(runProcess: ProcessRunner) {
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
      try {
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
            "https,tls,tcp",
            "-rw_timeout",
            "15000000",
            "-tls_verify",
            "1",
            "-verifyhost",
            source.hostname,
            "-i",
            audioUrl,
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
      } catch (error) {
        cache.delete(sourceKey);
        throw error;
      } finally {
        running -= 1;
      }
    })();
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(sourceKey, { expires: Date.now() + 10 * 60_000, result });
    return result;
  };
}

export const generateAudioWaveform = createAudioWaveformGenerator(
  createProcessRunner(),
);
