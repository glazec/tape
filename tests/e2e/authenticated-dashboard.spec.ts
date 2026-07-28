import { expect, test } from "@playwright/test";

import {
  authenticatedDashboardFixture,
  isolatedWorkspaceFixture,
} from "./authenticated-dashboard-fixture";

test("renders the authenticated dashboard with RLS scoped data", async ({
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

  const response = await page.goto("/dashboard");

  expect(response?.status()).toBeLessThan(500);
  await expect(page).toHaveURL("/dashboard");
  await expect(
    page.getByRole("heading", {
      name: `Welcome back, ${authenticatedDashboardFixture.name.split(" ")[0]}.`,
    }),
  ).toBeVisible();
  await expect(page.getByText("You had 1 meeting since Monday.")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: authenticatedDashboardFixture.meetingTitle,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(isolatedWorkspaceFixture.meetingTitle),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Loading dashboard overview" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Loading meetings" }),
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
