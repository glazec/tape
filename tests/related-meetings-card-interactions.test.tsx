// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RelatedMeetingsCard } from "@/components/related-meetings-card";

describe("RelatedMeetingsCard interactions", () => {
  it("shows and hides the transcript preview on hover and focus", () => {
    render(
      <RelatedMeetingsCard
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Hydradb <> IOSG",
            startedAt: "2026-07-13T15:30:00.000Z",
            hasMoreTranscriptSegments: false,
            transcriptPreview: [
              {
                id: "segment_1",
                speaker: "Yiping Lu",
                startMs: 243_000,
                text: "Hey, how are you?",
              },
            ],
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: "Hydradb <> IOSG" });
    const item = link.closest("li");
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    expect(item).toBeTruthy();
    expect(tooltip.className).toContain("hidden");
    expect(link.getAttribute("aria-controls")).toBe(tooltip.id);
    expect(link.getAttribute("aria-describedby")).toBe(`${tooltip.id}-label`);
    expect(link.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(`${tooltip.id}-label`)?.textContent).toContain(
      "Transcript preview",
    );

    fireEvent.mouseEnter(item!);
    expect(tooltip.className).toContain("block");
    expect(link.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseLeave(item!);
    expect(tooltip.className).toContain("hidden");

    fireEvent.focus(link);
    expect(tooltip.className).toContain("block");

    fireEvent.blur(link);
    expect(tooltip.className).toContain("hidden");
  });
});
