// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranscriptViewer } from "@/components/transcript-viewer";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const segment = {
  id: "target",
  speaker: "A",
  startMs: 10000,
  endMs: 20000,
  text: "Budget discussed",
};
it("navigates a read-only transcript without audio and highlights its nearest line", () => {
  render(
    <TranscriptViewer navigationMeetingId="source" segments={[segment]} />,
  );
  const detail = { meetingId: "source", timestampMs: 12000, handled: false };
  act(() =>
    window.dispatchEvent(new CustomEvent("tape:note-moment", { detail })),
  );
  expect(detail.handled).toBe(true);
  expect(
    document.getElementById("target")?.getAttribute("data-note-moment-active"),
  ).toBe("true");
  expect(document.activeElement).toBe(document.getElementById("target"));
  expect(window.scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: "smooth" }),
  );
});
it("seeks only the selected composed source player", async () => {
  const view = render(
    <>
      <TranscriptViewer
        navigationMeetingId="first"
        audioUrl="/first"
        segments={[segment]}
      />
      <TranscriptViewer
        navigationMeetingId="second"
        audioUrl="/second"
        segments={[{ ...segment, id: "other" }]}
      />
    </>,
  );
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent("tape:note-moment", {
        detail: { meetingId: "second", timestampMs: 12000 },
      }),
    ),
  );
  const audio = view.container.querySelectorAll("audio");
  expect(audio[0].currentTime).toBe(0);
  expect(audio[1].currentTime).toBe(12);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});

it("reveals the target without smooth scrolling when reduced motion is requested", () => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
  render(
    <TranscriptViewer navigationMeetingId="source" segments={[segment]} />,
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent("tape:note-moment", {
        detail: { meetingId: "source", timestampMs: 12000 },
      }),
    ),
  );
  expect(document.activeElement).toBe(document.getElementById("target"));
  expect(window.scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: "auto" }),
  );
});

it("shows only the selected note line without audio", () => {
  render(
    <TranscriptViewer
      navigationMeetingId="source"
      segments={[
        {
          ...segment,
          id: "opening",
          startMs: 0,
          endMs: 10000,
          text: "Opening",
        },
        segment,
      ]}
    />,
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent("tape:note-moment", {
        detail: { meetingId: "source", timestampMs: 12000 },
      }),
    ),
  );
  expect(
    document.getElementById("opening")?.classList.contains("bg-primary/5"),
  ).toBe(false);
  expect(
    document.getElementById("target")?.classList.contains("bg-primary/5"),
  ).toBe(true);
});
it.each(["timeupdate", "seek"])(
  "clears the note highlight after subsequent playback %s",
  async (action) => {
    const view = render(
      <TranscriptViewer
        navigationMeetingId="source"
        audioUrl="/audio"
        segments={[
          {
            ...segment,
            id: "opening",
            startMs: 0,
            endMs: 10000,
            text: "Opening",
          },
          segment,
        ]}
      />,
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("tape:note-moment", {
          detail: { meetingId: "source", timestampMs: 12000 },
        }),
      ),
    );
    expect(
      document
        .getElementById("target")
        ?.getAttribute("data-note-moment-active"),
    ).toBe("true");
    if (action === "timeupdate") {
      const audio = view.container.querySelector("audio")!;
      audio.currentTime = 2;
      fireEvent.timeUpdate(audio);
    } else {
      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Play from 0:00" })),
      );
    }
    expect(
      document
        .getElementById("target")
        ?.hasAttribute("data-note-moment-active"),
    ).toBe(false);
    expect(
      document.getElementById("target")?.classList.contains("bg-primary/5"),
    ).toBe(false);
    expect(
      document.getElementById("opening")?.classList.contains("bg-primary/5"),
    ).toBe(true);
  },
);
