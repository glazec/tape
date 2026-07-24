import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { expect, test } from "@playwright/test";

const appDirectory = resolve(process.cwd(), "app");
const pageRoutes = discoverPageRoutes(appDirectory);
const publicPageHeadings: Record<string, string> = {
  "/privacy": "Your meetings remain your record.",
  "/terms": "A shared record needs shared responsibility.",
};

for (const route of pageRoutes) {
  test(`${route} loads without a server error`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(route);

    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Internal Server Error" }),
    ).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    if (route === "/") {
      await expect(page.getByText("Every conversation,")).toBeVisible();
    } else if (publicPageHeadings[route]) {
      await expect(
        page.getByRole("heading", { name: publicPageHeadings[route] }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("button", { name: "Continue with Google" }),
      ).toBeVisible();
    }
  });
}

function discoverPageRoutes(directory: string) {
  return listPageFiles(directory)
    .map((file) => pageFileToRoute(file))
    .sort();
}

function listPageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listPageFiles(path);
    }

    return entry.name === "page.tsx" ? [path] : [];
  });
}

function pageFileToRoute(file: string) {
  const segments = relative(appDirectory, file)
    .split(sep)
    .slice(0, -1)
    .flatMap((segment) => materializeRouteSegment(segment));

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

function materializeRouteSegment(segment: string) {
  if (
    (segment.startsWith("(") && segment.endsWith(")")) ||
    segment.startsWith("@")
  ) {
    return [];
  }

  if (segment === "[meetingId]") {
    return ["11111111-1111-4111-8111-111111111111"];
  }

  if (segment.startsWith("[") && segment.endsWith("]")) {
    return ["smoke-test-value"];
  }

  return [segment];
}
