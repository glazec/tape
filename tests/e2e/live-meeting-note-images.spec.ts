import { expect, test } from "@playwright/test";

const meetingId = process.env.TAPE_SMOKE_MEETING_ID;
const ownerState = process.env.TAPE_SMOKE_OWNER_STATE;
const readerState = process.env.TAPE_SMOKE_READER_STATE;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";

test("a private note image survives reload and stays private in storage", async ({ browser, baseURL }) => {
  if (!meetingId || !process.env.PLAYWRIGHT_BASE_URL || !ownerState || !readerState || ownerState === readerState) {
    throw new Error("Provide a disposable shared meeting, a deployed base URL, and separate owner and reader session files.");
  }

  const owner = await browser.newContext({ baseURL, storageState: ownerState });
  const reader = await browser.newContext({ baseURL, storageState: readerState });
  try {
    const noteRoute = `/api/meetings/${meetingId}/notes`;
    expect((await reader.request.get(noteRoute)).status()).toBe(200);

    const page = await owner.newPage();
    await page.goto(`/meetings/${meetingId}?view=notes`);
    const editor = page.getByRole("textbox", { name: "My notes", exact: true });
    await expect(editor).toBeEditable();
    await expect(editor).toHaveText("");
    const image = page.getByRole("img", { name: "Pasted note image" });
    await expect(image).toHaveCount(0);

    const saved = page.waitForResponse(response =>
      new URL(response.url()).pathname === noteRoute && response.request().method() === "PUT",
    );
    await editor.evaluate((element, imageBytes) => {
      const data = new DataTransfer();
      const bytes = Uint8Array.from(atob(imageBytes), character => character.charCodeAt(0));
      data.items.add(new File([bytes], "note.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }));
    }, png);
    expect((await saved).ok()).toBe(true);

    await page.reload();
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", new RegExp(`^${noteRoute}/images\\?id=`));
    await expect(image).toHaveJSProperty("naturalWidth", 1);

    const path = await image.getAttribute("src");
    const readerRedirect = await reader.request.get(path!, { maxRedirects: 0 });
    expect(readerRedirect.status()).toBe(307);
    const denied = await reader.request.get(path!);
    expect([403, 404]).toContain(denied.status());
  } finally {
    await Promise.all([owner.close(), reader.close()]);
  }
});
