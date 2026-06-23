import { expect, test } from "@playwright/test";

test("shows the Meeting Transcript landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Meeting Transcript" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toHaveAttribute("href", "/auth/sign-in");
  await expect(page.getByText("Transcript queue")).toBeVisible();
  await expect(page.getByText("Internal attendee access")).toBeVisible();
  await expect(page.getByText("Search transcripts")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveCSS(
    "background-color",
    "rgb(0, 107, 255)",
  );
});

test("opens the sign in page from the landing call to action", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Sign in with Google" }).click();

  await expect(page).toHaveURL("/auth/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("starts Google sign in through the Neon Auth social endpoint", async ({
  page,
}) => {
  let requestBody: unknown;

  await page.route("**/api/auth/sign-in/social", async (route) => {
    requestBody = route.request().postDataJSON();

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "/dashboard", redirect: false }),
    });
  });

  await page.goto("/auth/sign-in");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect
    .poll(() => requestBody)
    .toEqual({
      provider: "google",
      callbackURL: "/dashboard",
      errorCallbackURL: "/auth/sign-in",
    });
});
