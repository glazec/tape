import { expect, test } from "@playwright/test";

test("redirects anonymous dashboard visitors to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL("/auth/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("redirects anonymous meeting transcript visitors to sign in", async ({
  page,
}) => {
  await page.goto("/meetings/weekly-product-review");

  await expect(page).toHaveURL("/auth/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("redirects anonymous team settings visitors to sign in", async ({
  page,
}) => {
  await page.goto("/settings/team");

  await expect(page).toHaveURL("/auth/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});
