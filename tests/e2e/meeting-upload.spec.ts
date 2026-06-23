import { expect, test } from "@playwright/test";

test("user can open upload flow", async ({ page }) => {
  await page.goto("/meetings/new");
  await expect(page.getByText("Upload MP3")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload", exact: true }),
  ).toBeVisible();
});

test("uploads a selected MP3 through a signed upload URL", async ({ page }) => {
  let requestedUploadUrl = false;
  let uploadedFile = false;

  await page.route("**/api/upload", async (route) => {
    requestedUploadUrl = true;
    expect(route.request().method()).toBe("POST");
    expect(await route.request().postDataJSON()).toEqual({
      extension: "mp3",
      contentType: "audio/mpeg",
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        key: "users/user_123/uploads/upload_123.mp3",
        uploadId: "upload_123",
        uploadUrl: "https://r2.example.com/upload_123",
      }),
    });
  });

  await page.route("https://r2.example.com/upload_123", async (route) => {
    uploadedFile = true;
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["content-type"]).toBe("audio/mpeg");
    await route.fulfill({ status: 200 });
  });

  await page.goto("/meetings/new");
  await page.setInputFiles("#meeting-audio", {
    name: "sample.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("fake mp3"),
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(page.getByText("Upload complete")).toBeVisible();
  expect(requestedUploadUrl).toBe(true);
  expect(uploadedFile).toBe(true);
});
