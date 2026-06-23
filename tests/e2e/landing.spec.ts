import { expect, test } from "@playwright/test";

test("shows the Meeting Transcript landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Team meeting transcripts/i }),
  ).toBeVisible();
  await expect(page.getByText("Meeting Transcript", { exact: true })).toBeVisible();
});
