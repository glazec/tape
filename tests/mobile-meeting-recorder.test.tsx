// @vitest-environment happy-dom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, replace } = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));

import { MobileMeetingRecorder } from "@/components/mobile-meeting-recorder";
import { getMobileRecordingFileType, selectMobileRecorderMimeType } from "@/lib/mobile-recorder";

describe("mobile meeting recorder", () => {
  let trackStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refresh.mockReset();
    replace.mockReset();
    trackStop = vi.fn();
    MockMediaRecorder.instances = [];
    MockMediaRecorder.supported = true;
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects browsers without recording support", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<MobileMeetingRecorder meetingId="meeting 1" meetingTitle="Founder visit" />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("Audio recording is not supported in this browser")).toBeTruthy();
  });

  it("reports unsupported formats and denied microphone access", async () => {
    MockMediaRecorder.supported = false;
    const { unmount } = render(<MobileMeetingRecorder meetingId="meeting 1" meetingTitle="Founder visit" />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("This browser cannot create a supported audio recording")).toBeTruthy();
    unmount();

    MockMediaRecorder.supported = true;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error("denied"));
    render(<MobileMeetingRecorder meetingId="meeting 1" meetingTitle="Founder visit" />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("Microphone access is required to record this meeting")).toBeTruthy();
  });

  it("records, uploads, redirects, and stops the microphone", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<MobileMeetingRecorder meetingId="meeting 1" meetingTitle="Founder visit" />);

    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await act(async () => Promise.resolve());
    expect(screen.getByText("Recording")).toBeTruthy();

    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByText("01:01")).toBeTruthy();

    const recorder = MockMediaRecorder.instances[0];
    recorder.emitData(new Blob(["audio"]));
    fireEvent.click(screen.getByRole("button", { name: "Stop and upload" }));
    await act(async () => Promise.resolve());

    expect(fetch).toHaveBeenCalledWith(
      "/api/meetings/meeting%201/uploads/audio",
      expect.objectContaining({ method: "POST" }),
    );
    expect(replace).toHaveBeenCalledWith("/meetings/meeting%201");
    expect(refresh).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it("handles empty recordings and failed uploads", async () => {
    const { unmount } = render(<MobileMeetingRecorder meetingId="meeting" meetingTitle="Founder visit" />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(screen.getByText("Recording")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop and upload" }));
    expect(await screen.findByText("The recording was empty or used an unsupported format")).toBeTruthy();
    unmount();

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<MobileMeetingRecorder meetingId="meeting" meetingTitle="Founder visit" />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(screen.getByText("Recording")).toBeTruthy());
    MockMediaRecorder.instances.at(-1)?.emitData(new Blob(["audio"]));
    fireEvent.click(screen.getByRole("button", { name: "Stop and upload" }));
    expect(await screen.findByText("Could not upload the recording. Please try again")).toBeTruthy();
  });

  it("warns during recording and discards data after unmount", async () => {
    const { unmount } = render(<MobileMeetingRecorder meetingId="meeting" meetingTitle="Founder visit" />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(screen.getByText("Recording")).toBeTruthy());

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    unmount();
    expect(trackStop).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects recording formats accepted by transcription", () => {
    expect(selectMobileRecorderMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(selectMobileRecorderMimeType((type) => type === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(getMobileRecordingFileType("audio/webm;codecs=opus")).toEqual({ contentType: "audio/webm", extension: "webm" });
  });
});

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static supported = true;
  static isTypeSupported() {
    return MockMediaRecorder.supported;
  }

  mimeType: string;
  state: RecordingState = "inactive";
  private listeners = new Map<string, EventListener>();

  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? "";
    MockMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.listeners.get("stop")?.(new Event("stop"));
  }

  emitData(data: Blob) {
    const event = new Event("dataavailable") as BlobEvent;
    Object.defineProperty(event, "data", { value: data });
    this.listeners.get("dataavailable")?.(event);
  }
}
