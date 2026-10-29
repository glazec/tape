import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createAudioWaveformGenerator } from "@/lib/audio-waveform-server";
import { normalizeAudioPeaks, resampleAudioPeaks } from "@/lib/audio-waveform";
import { createProcessRunner } from "@/lib/video-frame-ffmpeg";

describe("bundled waveform decoder", () => {
  it("decodes quiet, loud, and silent audio over HTTPS", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tape-waveform-"));
    const certificate = join(directory, "certificate.pem");
    const key = join(directory, "key.pem");
    const audio = join(directory, "audio.wav");
    const binary = resolve("node_modules/ffmpeg-static/ffmpeg");
    const run = createProcessRunner();
    let server: ReturnType<typeof createServer> | undefined;
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost",
          "-keyout",
          key,
          "-out",
          certificate,
        ],
        { stdio: "ignore" },
      );
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
      server = createServer(
        { key: readFileSync(key), cert: readFileSync(certificate) },
        (_request, response) => {
          response.writeHead(200, {
            "content-type": "audio/wav",
            "content-length": bytes.length,
          });
          response.end(bytes);
        },
      );
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test server port");
      // The local fixture has a self signed certificate. Production must keep TLS verification enabled.
      const generate = createAudioWaveformGenerator(
        (_binary, args, options) => {
          const verifyIndex = args.indexOf("-tls_verify") + 1;
          expect(args[verifyIndex]).toBe("1");
          const fixtureArgs = [...args];
          fixtureArgs[verifyIndex] = "0";
          return run(binary, fixtureArgs, options);
        },
      );
      const peaks = await generate(
        `https://localhost:${address.port}/audio.wav`,
        "fixture",
      );
      const levels = normalizeAudioPeaks(resampleAudioPeaks(peaks, 120));
      expect(levels[5]).toBe(0);
      expect(levels[50]).toBeGreaterThan(0);
      expect(levels[50]).toBeLessThan(0.01);
      expect(levels[100]).toBeGreaterThan(0.95);
    } finally {
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
