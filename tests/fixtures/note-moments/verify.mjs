import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const output = path.join(
  os.tmpdir(),
  "tape-note-moments-components",
  "screenshots",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  timezoneId: "America/New_York",
  locale: "en-US",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:8778");
await page
  .getByLabel("Recording files")
  .setInputFiles("/Users/glaze/Downloads/Oct 19 at 11-41 AM.m4a");
await expect(page.getByText(/Suggested from filename/)).toBeVisible();
await expect(
  page.getByRole("radio", { name: /Product review with Maya/ }),
).toBeVisible();
await expect(
  page.getByRole("button", { name: "Upload recording", exact: true }),
).toBeDisabled();
const media = page.getByLabel("Recording preview");
await expect
  .poll(() => media.evaluate((element) => element.duration), { timeout: 15000 })
  .toBeGreaterThan(5127);
await page.getByLabel("Jump to time").fill("1:02:34");
await page.getByRole("button", { name: "Jump", exact: true }).click();
await expect
  .poll(() => media.evaluate((element) => element.currentTime))
  .toBe(3754);
await media.evaluate((element) => element.play());
await expect
  .poll(() => media.evaluate((element) => element.currentTime))
  .toBeGreaterThan(3754);
await media.evaluate((element) => element.pause());
await page.getByRole("radio", { name: /Product review with Maya/ }).check();
await expect(
  page.getByRole("button", { name: "Upload to Product review with Maya" }),
).toBeEnabled();
await page.waitForTimeout(250);
await page.screenshot({
  path: path.join(output, "import-desktop.png"),
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({
  path: path.join(output, "import-mobile.png"),
  fullPage: true,
});
await expect
  .poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  )
  .toBe(true);
await page.setViewportSize({ width: 320, height: 740 });
await expect
  .poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  )
  .toBe(true);
await page.waitForTimeout(250);
await page.screenshot({
  path: path.join(output, "import-320.png"),
  fullPage: true,
});
await page.setViewportSize({ width: 1440, height: 1100 });
await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
await page.getByRole("button", { name: "Go to 12:34 in transcript" }).click();
await expect(page.locator("#budget-segment")).toBeFocused();
await page.waitForTimeout(250);
await page.screenshot({
  path: path.join(output, "notes-desktop.png"),
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({
  path: path.join(output, "notes-mobile.png"),
  fullPage: true,
});
await expect
  .poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  )
  .toBe(true);
await page.getByRole("button", { name: "Simulate live recording" }).click();
await page.getByRole("button", { name: "Edit notes", exact: true }).click();
const note = page.getByRole("textbox", { name: "My notes", exact: true });
await note.fill("@now");
await note.press("Space");
await note.pressSequentially("Confirm the updated budget.");
await page.getByRole("heading", { level: 1 }).click();
await expect(page.getByText(/Moment saved|Moment captured/)).toBeVisible();
await expect(page.getByText("Saved", { exact: true })).toBeVisible();
await page.reload();
await page.getByRole("button", { name: "Meeting notes", exact: true }).click();
await expect(
  page.locator("p").filter({ hasText: "Confirm the updated budget." }),
).toBeVisible();
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  JSON.stringify(
    {
      sampleDuration: 5127.9,
      seekSeconds: 3754,
      playback: "advanced",
      widths: [1440, 390, 320],
      savedReload: true,
      consoleErrors: errors,
      screenshots: output,
    },
    null,
    2,
  ),
);
await browser.close();
