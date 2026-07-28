import { expect, test } from "@playwright/test";

test("/admin renders for an authenticated admin", async ({ page }) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  const response = await page.goto("/admin");

  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveURL("/admin");
  await expect(
    page.getByRole("heading", { name: "User view control" }),
  ).toBeVisible();
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Internal Server Error" }),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
