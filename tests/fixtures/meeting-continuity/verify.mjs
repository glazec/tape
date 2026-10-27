import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const screenshots = path.join(
  os.tmpdir(),
  "tape-continuity-components",
  "screenshots",
);
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:8777");
await page
  .getByRole("textbox", { name: "My notes" })
  .fill("Keep this private note through merge and undo.");
await page
  .getByRole("button", { name: "Continue recording", exact: true })
  .click();
await expect(page.getByRole("textbox", { name: "Meeting link" })).toBeFocused();
await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCount(1);
await expect(page.getByRole("dialog")).not.toContainText("yiping@");
await page.screenshot({
  path: path.join(screenshots, "continue-desktop.png"),
  animations: "disabled",
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: path.join(screenshots, "continue-mobile.png"),
  animations: "disabled",
});
await page.keyboard.press("Escape");
await expect(page.getByRole("dialog")).toHaveCount(0);
await expect(
  page.getByRole("button", { name: "Continue recording", exact: true }),
).toBeFocused();
await page.getByLabel("More meeting actions").first().click();
await page.getByRole("button", { name: "Merge meetings", exact: true }).click();
await page.getByRole("radio").first().check();
await expect(
  page.getByRole("button", { name: "Merge meetings", exact: true }),
).toBeEnabled();
await page.screenshot({
  path: path.join(screenshots, "merge-mobile.png"),
  animations: "disabled",
});
await page.getByRole("button", { name: "Merge meetings", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await expect(
  page.getByRole("heading", {
    name: "Product conversation · next recording",
    exact: true,
  }),
).toBeVisible();
await expect(
  page.getByText("Preparing transcript", { exact: true }),
).toBeVisible();
await expect(page.getByRole("textbox", { name: "My notes" })).toHaveValue(
  "Keep this private note through merge and undo.",
);
await expect(page.getByRole("heading", { name: /summary/i })).toHaveCount(0);
await expect
  .poll(() => page.evaluate(() => document.body.style.overflow))
  .toBe("");
await page.screenshot({
  path: path.join(screenshots, "merged-mobile.png"),
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "Undo merge", exact: true }).click();
await expect(
  page.getByRole("heading", {
    name: "Product conversation · next recording",
    exact: true,
  }),
).toHaveCount(0);
await expect(page.getByRole("textbox", { name: "My notes" })).toHaveValue(
  "Keep this private note through merge and undo.",
);
await page
  .getByRole("button", { name: "Edit speaker yiping@iosf.vc", exact: true })
  .click();
await page.getByRole("combobox", { name: "Speaker name" }).fill("Yiping");
await expect(
  page.getByRole("checkbox", { name: /Remember for future meetings/ }),
).toBeChecked();
await page.screenshot({
  path: path.join(screenshots, "name-mobile.png"),
  fullPage: true,
  animations: "disabled",
});
await page.getByRole("button", { name: "Save speaker" }).click();
await expect(
  page.getByRole("button", { name: "Edit speaker Yiping", exact: true }),
).toBeVisible();
expect(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
).toBe(false);

const expiry = await browser.newPage({ viewport: { width: 390, height: 844 } });
await expiry.clock.install({ time: new Date("2026-10-27T16:00:00Z") });
await expiry.goto("http://127.0.0.1:8777");
await expiry
  .getByRole("button", { name: "Continue recording", exact: true })
  .click();
await expiry.clock.fastForward(45 * 60 * 1000 + 1000);
await expect(expiry.getByRole("alert")).toContainText(
  "one hour window has ended",
);
await expect(
  expiry.getByRole("button", { name: "Join and continue" }),
).toHaveCount(0);
await expiry.screenshot({
  path: path.join(screenshots, "expired-mobile.png"),
  animations: "disabled",
});
await expiry.getByRole("button", { name: "Close", exact: true }).click();
await expect(
  expiry.getByRole("button", { name: "Continue recording", exact: true }),
).toHaveCount(0);
expect(errors).toEqual([]);
console.log(
  "Verified: desktop/mobile dialog, focus return, organization naming boundary, pending merge, undo, note preservation, exact email correction, expiry while open, no page errors or horizontal overflow.",
);
console.log(`Screenshots: ${screenshots}`);
await browser.close();
