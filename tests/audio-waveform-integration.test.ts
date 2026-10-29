import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createAudioWaveformGenerator } from "@/lib/audio-waveform-server";
import { normalizeAudioPeaks, resampleAudioPeaks } from "@/lib/audio-waveform";
import { createProcessRunner } from "@/lib/video-frame-ffmpeg";

describe("bundled waveform decoder", () => {
  it("downloads and decodes quiet, loud, and silent audio with the bundled binary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tape-waveform-fixture-"));
    const audio = join(directory, "audio.wav");
    const binary = resolve("node_modules/ffmpeg-static/ffmpeg");
    const run = createProcessRunner();
    let server: ReturnType<typeof createServer> | undefined;
    let decodedPath: string | undefined;
    try {
      execFileSync(binary, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(lt(t\\,1)\\,0\\,if(lt(t\\,2)\\,0.02\\,0.4))*sin(2*PI*440*t):s=16000:d=3",
        audio,
      ]);
      const bytes = readFileSync(audio);
      server = createServer((_request, response) => {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": bytes.length,
        });
        response.end(bytes);
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test server port");
      const generate = createAudioWaveformGenerator(
        (_binary, args, options) => {
          decodedPath = args[args.indexOf("-i") + 1];
          expect(readFileSync(decodedPath)).toEqual(bytes);
          expect(args).not.toContain("https://audio.example.com/fixture");
          return run(binary, args, options);
        },
        (url, options) => {
          expect(url).toBe("https://audio.example.com/fixture");
          expect(options?.redirect).toBe("error");
          return fetch(`http://127.0.0.1:${address.port}/audio.wav`, options);
        },
      );
      const peaks = await generate(
        "https://audio.example.com/fixture",
        "fixture",
      );
      const levels = normalizeAudioPeaks(resampleAudioPeaks(peaks, 120));
      expect(levels[5]).toBe(0);
      expect(levels[50]).toBeGreaterThan(0);
      expect(levels[50]).toBeLessThan(0.01);
      expect(levels[100]).toBeGreaterThan(0.95);
      expect(existsSync(decodedPath!)).toBe(false);
    } finally {
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
