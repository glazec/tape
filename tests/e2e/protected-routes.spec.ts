import { expect, test } from "@playwright/test";

test("redirects anonymous dashboard visitors to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL((url) =>
    url.pathname === "/auth/sign-in" && url.searchParams.get("callbackUrl") === "/dashboard",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("redirects anonymous meeting transcript visitors to sign in", async ({
  page,
}) => {
  await page.goto("/meetings/weekly-product-review");

  await expect(page).toHaveURL((url) =>
    url.pathname === "/auth/sign-in" && url.searchParams.get("callbackUrl") === "/meetings/weekly-product-review",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("redirects anonymous new meeting visitors to sign in", async ({ page }) => {
  await page.goto("/meetings/new");

  await expect(page).toHaveURL((url) =>
    url.pathname === "/auth/sign-in" && url.searchParams.get("callbackUrl") === "/meetings/new",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("redirects anonymous team settings visitors to sign in", async ({
  page,
}) => {
  await page.goto("/settings/team");

  await expect(page).toHaveURL((url) =>
    url.pathname === "/auth/sign-in" && url.searchParams.get("callbackUrl") === "/settings/team",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});
