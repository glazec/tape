import { expect, test, type Page } from "@playwright/test";

const longValue = "a".repeat(80);

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe("dynamic route values on mobile", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("long shared transcript tokens do not create horizontal overflow", async ({
    page,
  }) => {
    await page.goto(`/share/${longValue}`);

    await expect(
      page.getByRole("heading", { name: "Weekly product review" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("long meeting IDs do not create horizontal overflow", async ({ page }) => {
    await page.goto(`/meetings/${longValue}`);

    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
