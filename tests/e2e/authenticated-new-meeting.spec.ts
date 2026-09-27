import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("new meeting source choices center their inputs on mobile", async ({ page }) => {
  await page.goto("/meetings/new");

  for (const [option, label] of [
    [/Meeting link/, "Meeting link"],
    [/Recording file/, "Recording files"],
    [/Transcript/, "Transcript text"],
    [/Record on phone/, "Meeting title"],
  ] as const) {
    const button = page.getByRole("group", { name: "Meeting source" })
      .getByRole("button", { name: option });
    const input = page.getByLabel(label, { exact: true });
    // Selecting the active option again should bring its input back into view.
    for (let click = 0; click < 2; click += 1) {
      await button.click();
      await expect(input).toBeVisible();
      await expect.poll(async () => {
        const bounds = await input.boundingBox();
        return bounds ? Math.abs(bounds.y + bounds.height / 2 - 844 / 2) : Infinity;
      }).toBeLessThan(3);
      await expect(input).not.toBeFocused();
    }
  }
});
