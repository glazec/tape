import { expect, test } from "@playwright/test";

import {
  authenticatedDashboardFixture,
  isolatedWorkspaceFixture,
} from "./authenticated-dashboard-fixture";

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

test("admin can impersonate a user and return to the admin account", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/admin");
  await page
    .getByLabel("User")
    .selectOption(authenticatedDashboardFixture.userId);
  const [startResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/impersonation" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "View as user" }).click(),
  ]);

  expect(startResponse.status()).toBe(303);
  expect(startResponse.headers().location).toBe("/dashboard");
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("link", {
      name: authenticatedDashboardFixture.meetingTitle,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: isolatedWorkspaceFixture.meetingTitle }),
  ).toHaveCount(0);

  await page.goto("/admin");
  await expect(
    page.getByText(
      `Currently viewing as ${authenticatedDashboardFixture.email}`,
    ),
  ).toBeVisible();
  const [stopResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/impersonation" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Stop viewing as user" }).click(),
  ]);

  expect(stopResponse.status()).toBe(303);
  expect(stopResponse.headers().location).toBe("/admin");
  await expect(page).toHaveURL("/admin");
  await expect(page.getByText("You are using your own account.")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
