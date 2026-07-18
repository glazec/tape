import { describe, expect, it } from "vitest";

import { titleFromUploadFileName } from "@/lib/upload-titles";

describe("upload titles", () => {
  it("normalizes the uploaded file name", () => {
    expect(titleFromUploadFileName("records/weekly_partner-sync.MP3")).toBe(
      "weekly partner sync",
    );
  });

  it("uses a useful fallback when the file name has no title", () => {
    expect(titleFromUploadFileName(".mp3")).toBe("Uploaded audio");
  });
});
