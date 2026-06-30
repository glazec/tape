import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { UploadDropzone } from "@/components/upload-dropzone";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe("UploadDropzone", () => {
  it("allows users to set the uploaded meeting start time", () => {
    const html = renderToStaticMarkup(<UploadDropzone />);

    expect(html).toContain("Start time");
    expect(html).toContain('id="meeting-start-time"');
    expect(html).toContain('name="startedAt"');
    expect(html).toContain('type="datetime-local"');
  });
});
