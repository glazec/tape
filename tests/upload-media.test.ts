import { describe, expect, it } from "vitest";

import {
  getSupportedUploadMedia,
  getUploadMediaFromFile,
  uploadMediaAccept,
} from "@/lib/upload-media";

describe("upload media support", () => {
  it("recognizes M4A audio uploads from file metadata", () => {
    expect(
      getUploadMediaFromFile(
        new File(["fake m4a"], "founder-call.m4a", { type: "audio/mp4" }),
      ),
    ).toEqual({
      extension: "m4a",
      contentType: "audio/mp4",
      kind: "audio",
    });

    expect(
      getUploadMediaFromFile(
        new File(["fake m4a"], "founder-call.m4a", { type: "audio/x-m4a" }),
      ),
    ).toEqual({
      extension: "m4a",
      contentType: "audio/x-m4a",
      kind: "audio",
    });
  });

  it("allows M4A in signed upload requests", () => {
    expect(
      getSupportedUploadMedia({
        extension: "m4a",
        contentType: "audio/mp4",
      }),
    ).toEqual({
      extension: "m4a",
      contentType: "audio/mp4",
      kind: "audio",
    });
  });

  it("includes M4A in the browser file chooser accept list", () => {
    expect(uploadMediaAccept).toContain("audio/mp4");
    expect(uploadMediaAccept).toContain("audio/x-m4a");
    expect(uploadMediaAccept).toContain(".m4a");
  });
});
