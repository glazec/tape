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
  it("renders text, MP3, all, and copy export actions", () => {
    const html = renderToStaticMarkup(
      <MeetingActions meetingId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).toContain("Export text");
    expect(html).toContain(
      "/api/meetings/11111111-1111-4111-8111-111111111111/export?format=text",
    );
    expect(html).toContain("Export MP3");
    expect(html).toContain(
      "/api/meetings/11111111-1111-4111-8111-111111111111/export?format=mp3",
    );
    expect(html).toContain("Export all");
    expect(html).toContain("Copy");
  });
});
