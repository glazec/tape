// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MeetingVisualLightbox,
  TranscriptViewer,
  type MeetingVisualAsset,
} from "@/components/transcript-viewer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const visualAssets: MeetingVisualAsset[] = [
  {
    id: "image_123",
    capturedAt: null,
    timestampMs: 1_000,
    url: "/images/image_123",
  },
  {
    id: "image_456",
    capturedAt: null,
    timestampMs: 2_000,
    url: "/images/image_456",
  },
];

afterEach(() => cleanup());

describe("meeting image gallery", () => {
  it("returns to the overview after reviewing an image", () => {
    render(
      <TranscriptViewer
        segments={[
          {
            id: "segment_123",
            speaker: "Speaker 1",
            startMs: 0,
            endMs: 3_000,
            text: "Hello team",
          },
        ]}
        visualAssets={visualAssets}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Browse all captured images" }),
    );
    const overview = screen.getByRole("dialog", {
      name: "Captured image overview",
    });

    fireEvent.click(
      within(overview).getByRole("button", { name: "Open image from 0:01" }),
    );
    const lightbox = screen.getByRole("dialog", {
      name: "Meeting image gallery",
    });
    const fullImage = lightbox.querySelector<HTMLImageElement>(
      'img[src="/images/image_123"]',
    );

    expect(fullImage).not.toBeNull();
    fireEvent.load(fullImage!);
    expect(within(lightbox).queryByRole("status")).toBeNull();

    fireEvent.click(
      within(lightbox).getByRole("button", { name: "Close image gallery" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Captured image overview" }),
    ).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Captured image overview" }),
    ).toBeNull();
  });

  it("supports keyboard navigation and reports image failures", () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <MeetingVisualLightbox
        assetIndex={0}
        onClose={onClose}
        onNavigate={onNavigate}
        onShowInTranscript={vi.fn()}
        visualAssets={visualAssets}
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    const fullImage = screen
      .getByRole("dialog", { name: "Meeting image gallery" })
      .querySelector<HTMLImageElement>('img[src="/images/image_123"]');

    expect(fullImage).not.toBeNull();
    fireEvent.error(fullImage!);
    expect(screen.getByRole("alert").textContent).toBe(
      "Image could not be loaded",
    );
  });
});
