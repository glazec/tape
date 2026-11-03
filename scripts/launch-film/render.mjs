// Renders film.html frame by frame, so every frame is exact regardless of how
// fast the browser is, then muxes the frames with the music bed.
//
//   node scripts/launch-film/render.mjs <frames-dir> <music.mp3> <out.mp4>
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [framesDir, music, out] = process.argv.slice(2);
if (!framesDir || !music || !out) {
  console.error("usage: render.mjs <frames-dir> <music.mp3> <out.mp4>");
  process.exit(1);
}
const FPS = 30;
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await page.goto(`${pathToFileURL(resolve(here, "film.html")).href}?t=0`);
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState("networkidle");
const duration = await page.evaluate(() => window.DURATION);
const total = Math.round(duration * FPS);

for (let frame = 0; frame < total; frame += 1) {
  await page.evaluate((t) => window.render(t), frame / FPS);
  await page.screenshot({
    path: `${framesDir}/f${String(frame).padStart(4, "0")}.jpg`,
    type: "jpeg",
    quality: 92,
  });
  if (frame % 60 === 0) console.log(`frame ${frame}/${total}`);
}
await browser.close();

execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    `${framesDir}/f%04d.jpg`,
    "-i",
    music,
    "-filter_complex",
    `[1:a]afade=t=out:st=${duration - 1.2}:d=1.2[a]`,
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${out}`);
