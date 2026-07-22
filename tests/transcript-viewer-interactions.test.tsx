// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { TranscriptViewer, type TranscriptSegment } from "@/components/transcript-viewer";

const segments: TranscriptSegment[] = [
  { id: "seg_1", speaker: "Speaker 1", startMs: 0, endMs: 30_000, text: "raw opening words", polishedText: "Polished opening words", translatedText: "开场白", emotionLabel: "hard" },
  { id: "seg_2", speaker: "Speaker 2", startMs: 30_000, endMs: 60_000, text: "second speaker has enough words for a useful pace chart", emotionLabel: "chill" },
];

const visualAssets = [
  { id: "image_1", capturedAt: null, timestampMs: 5_000, url: "/images/one" },
  { id: "image_2", capturedAt: null, timestampMs: 40_000, url: "/images/two" },
];

describe("TranscriptViewer interactions", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: undefined,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("switches transcript language and text version", () => {
    render(<TranscriptViewer segments={segments} />);
    expect(document.getElementById("seg_1")?.textContent).toContain("Polished opening words");

    fireEvent.change(screen.getByLabelText("Transcript style"), { target: { value: "raw" } });
    expect(document.getElementById("seg_1")?.textContent).toContain("raw opening words");

    fireEvent.change(screen.getByLabelText("Transcript language"), { target: { value: "zh" } });
    expect(document.getElementById("seg_1")?.textContent).toContain("开场白");

    fireEvent.change(screen.getByLabelText("Transcript language"), { target: { value: "original" } });
    expect(document.getElementById("seg_1")?.textContent).toContain("Polished opening words");
  });

  it("validates, saves, scopes, and cancels speaker edits", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(
      <TranscriptViewer
        meetingId="meeting/one"
        segments={segments}
        speakerSuggestions={[{ email: "alice@example.com", name: "Alice Smith" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit speaker Speaker 1" }));
    const input = screen.getByLabelText("Speaker name");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
    expect(await screen.findByText("Add a speaker name.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Alice Smith" }));
    fireEvent.click(screen.getByRole("button", { name: "This line" }));
    fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
    expect(await screen.findByText("Alice Smith")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/meeting%2Fone/speakers",
      expect.objectContaining({ method: "PATCH" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename Speaker 2 everywhere" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel speaker edit" }));
    expect(screen.queryByLabelText("Speaker name")).toBeNull();
  });

  it("keeps the speaker editor open after a failed save", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<TranscriptViewer meetingId="meeting" segments={segments} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Speaker 1 everywhere" }));
    fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
    expect(await screen.findByText("Add a speaker name.")).toBeTruthy();
    expect(screen.getByLabelText("Speaker name")).toBeTruthy();
  });

  it("queues translation and reports service failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const summary = { hasTranslations: false, status: "failed" as const, totalSegments: 2, translatedSegments: 0 };
    const { unmount } = render(<TranscriptViewer meetingId="meeting" segments={segments} translationSummary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry translation" }));
    expect(await screen.findByText("Translation queued")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
    unmount();

    vi.mocked(fetch).mockReset().mockRejectedValueOnce(new Error("network"));
    render(<TranscriptViewer meetingId="meeting" segments={segments} translationSummary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry translation" }));
    expect(await screen.findByText("Could not start translation.")).toBeTruthy();
  });

  it("opens the overview, navigates the lightbox, and returns focus", async () => {
    render(<TranscriptViewer segments={segments} visualAssets={visualAssets} />);
    const browse = screen.getByRole("button", { name: "Browse all captured images" });
    browse.focus();
    fireEvent.click(browse);
    expect(screen.getByRole("dialog", { name: "Captured image overview" })).toBeTruthy();

    const overview = screen.getByRole("dialog", { name: "Captured image overview" });
    fireEvent.click(within(overview).getByRole("button", { name: "Open image from 0:40" }));
    expect(screen.getByText("2 of 2")).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(await screen.findByText("1 of 2")).toBeTruthy();

    const gallery = screen.getByRole("dialog", { name: "Meeting image gallery" });
    const image = gallery.querySelector("[aria-busy] img") as HTMLImageElement;
    fireEvent.load(image);
    expect(screen.queryByText("Loading image 1 of 2")).toBeNull();
    fireEvent.error(image);
    expect(screen.getByRole("alert").textContent).toContain("Image could not be loaded");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Captured image overview" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("seeks and controls playback from transcript and player controls", async () => {
    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperties(audio, {
      duration: { configurable: true, value: 60 },
      paused: { configurable: true, value: true },
    });
    fireEvent.durationChange(audio);

    fireEvent.click(screen.getByRole("button", { name: "Play from 0:30" }));
    await waitFor(() => expect(audio.currentTime).toBe(30));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Skip forward 5 seconds" }));
    expect(audio.currentTime).toBe(35);
    fireEvent.click(screen.getByRole("button", { name: "Skip back 5 seconds" }));
    expect(audio.currentTime).toBe(30);

    fireEvent.change(screen.getByLabelText("Audio progress"), { target: { value: "12" } });
    expect(audio.currentTime).toBe(12);
    fireEvent.change(screen.getByText("Playback speed").parentElement?.querySelector("select") as HTMLSelectElement, { target: { value: "1.5" } });
    expect(audio.playbackRate).toBe(1.5);

    fireEvent.play(audio);
    expect(await screen.findByRole("button", { name: "Pause audio" })).toBeTruthy();
    Object.defineProperty(audio, "paused", { configurable: true, value: false });
    fireEvent.click(screen.getByRole("button", { name: "Pause audio" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    fireEvent.ended(audio);
  });

  it("seeks from waveform and updates the hover WPM tooltip", () => {
    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 60 });
    fireEvent.durationChange(audio);
    const waveform = screen.getByRole("button", { name: /Audio waveform/ });
    vi.spyOn(waveform, "getBoundingClientRect").mockReturnValue(rect(100, 400));
    fireEvent.pointerDown(waveform, { clientX: 300 });
    expect(audio.currentTime).toBe(30);

    const trend = screen.getByText("Words per minute trend").previousElementSibling as HTMLElement;
    vi.spyOn(trend, "getBoundingClientRect").mockReturnValue(rect(100, 400));
    fireEvent.pointerMove(trend, { clientX: 200 });
    fireEvent.pointerLeave(trend);
  });

  it("decodes a short audio file into a waveform during idle time", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const decodeAudioData = vi.fn().mockResolvedValue({
      length: 4,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.1, -0.7, 0.4, 1]),
    });
    const AudioContextMock = class { close = close; decodeAudioData = decodeAudioData; };
    Object.defineProperty(window, "AudioContext", { configurable: true, value: AudioContextMock });
    Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: (callback: () => void) => {
      callback();
      return 1;
    }});
    Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: vi.fn() });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(3)),
    } as unknown as Response);

    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    await waitFor(() => expect(decodeAudioData).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/audio.mp3?proxy=1", expect.objectContaining({ credentials: "include" }));
    expect(close).toHaveBeenCalled();
  });

  it("stops showing waveform activity when background audio loading fails", async () => {
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));

    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    const waveform = screen.getByRole("button", { name: /Audio waveform/ });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(waveform.querySelector(".animate-pulse")).toBeNull(),
    );
  });

  it("previews a speaker across clips and stops at the end", async () => {
    render(<TranscriptViewer audioUrl="/audio.mp3" segments={[
      { id: "a1", speaker: "Alice", startMs: 0, endMs: 1000, text: "one" },
      { id: "b1", speaker: "Bob", startMs: 1000, endMs: 2000, text: "two" },
      { id: "a2", speaker: "Alice", startMs: 2000, endMs: 3000, text: "three" },
    ]} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "paused", { configurable: true, value: false });
    fireEvent.click(screen.getByRole("button", { name: "Preview Alice" }));
    await waitFor(() => expect(audio.currentTime).toBe(0));
    audio.currentTime = 1.1;
    fireEvent.timeUpdate(audio);
    expect(audio.currentTime).toBe(2);
    audio.currentTime = 3.1;
    fireEvent.timeUpdate(audio);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("shows an image in its transcript row and covers translation status variants", () => {
    const { unmount } = render(<TranscriptViewer segments={segments} visualAssets={visualAssets} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open image from 0:40" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Show in transcript" }));
    expect(window.scrollTo).toHaveBeenCalled();
    unmount();

    const statuses = [
      { status: "queued" as const, title: "Translation queued" },
      { status: "partial" as const, title: "Translation partially available" },
      { status: "not_started" as const, title: "Translation not started" },
    ];
    for (const item of statuses) {
      const view = render(<TranscriptViewer segments={segments} translationSummary={{
        hasTranslations: false,
        status: item.status,
        totalSegments: 2,
        translatedSegments: item.status === "partial" ? 1 : 0,
      }} />);
      expect(screen.getByText(item.title)).toBeTruthy();
      view.unmount();
    }
  });

  it("reports playback rejection instead of leaving the player looking healthy", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("blocked"));
    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    const transcriptButton = screen.getByRole("button", { name: "Play transcript from 0:00" });
    const secondWord = transcriptButton.querySelector('[data-transcript-word-index="1"]') as HTMLElement;
    fireEvent.click(secondWord);
    await waitFor(() => expect(audio.currentTime).toBeGreaterThan(0));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Recording could not be played. Reload and try again.",
    );
  });

  it("reports playback rejection from the persistent audio controls", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new Error("blocked"),
    );
    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);

    fireEvent.click(screen.getByRole("button", { name: "Play audio" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Recording could not be played. Reload and try again.",
    );
  });

  it("reports media loading failures and clears the error after recovery", async () => {
    render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;

    fireEvent.error(audio);
    expect(screen.getByRole("alert").textContent).toContain(
      "Recording could not be played. Reload and try again.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.canPlay(audio);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the compact waveform on mobile and responds to media query changes", () => {
    let change: (() => void) | undefined;
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn((_event, listener) => { change = listener as () => void; }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const { unmount } = render(<TranscriptViewer audioUrl="/audio.mp3" segments={segments} />);
    expect(screen.getByRole("button", { name: /Audio waveform/ }).querySelectorAll(".flex-1").length).toBe(56);
    change?.();
    unmount();
  });
});

function rect(left: number, width: number): DOMRect {
  return { left, width, right: left + width, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) };
}
