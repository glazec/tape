import { expect, test } from "@playwright/test";

test("shows the Meeting Transcript landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Sign in to your team transcript workspace/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toHaveAttribute("href", "/api/auth/signin/google");
  await expect(page.getByText("Meeting Transcript", { exact: true })).toBeVisible();
});
