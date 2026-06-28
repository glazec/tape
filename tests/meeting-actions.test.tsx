import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MeetingActions } from "@/components/meeting-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("MeetingActions", () => {
  it("renders a single export dropdown with transcript and MP3 choices", () => {
    const html = renderToStaticMarkup(
      <MeetingActions meetingId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).toContain("Export");
    expect(html).toContain("Transcript");
    expect(html).toContain("MP3");
    expect(html).toContain("Download selected");
    expect(html).not.toContain("Export text");
    expect(html).not.toContain("Export MP3");
    expect(html).not.toContain("Export all");
    expect(html).toContain("Copy");
    expect(html).toContain("Delete");
  });
});
