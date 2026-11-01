// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { RecordingFilePreview } from "@/components/recording-file-preview";
import { RecordingImportReview } from "@/components/recording-import-review";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ meetings: [] }))),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const file = () =>
  new File(["audio"], "Oct 19 at 11-41 AM.m4a", {
    type: "audio/mp4",
    lastModified: Date.parse("2026-10-30T12:00Z"),
  });

describe("recording import review", () => {
  it("keeps preview local and requires an explicit destination", async () => {
    const changed = vi.fn();
    render(<RecordingImportReview file={file()} onChange={changed} />);
    expect(screen.getByText(/Suggested from filename/)).toBeTruthy();
    expect(screen.getByLabelText("Recording preview").getAttribute("src")).toBe(
      "blob:preview",
    );
    await screen.findByText(/No nearby calendar meetings/);
    expect(changed.mock.lastCall?.[0].ready).toBe(false);
    fireEvent.click(
      screen.getByRole("radio", { name: /Create a new meeting/ }),
    );
    await waitFor(() => expect(changed.mock.lastCall?.[0].ready).toBe(true));
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([url]) =>
          String(url).startsWith("/api/uploads/meeting-candidates?"),
        ),
    ).toBe(true);
  });
  it("selects a calendar destination and clears it when time changes", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          meetings: [
            {
              id: "target",
              title: "Budget review",
              startedAt: "2026-10-19T15:30:00Z",
              endedAt: "2026-10-19T17:00:00Z",
              unavailableReason: null,
            },
          ],
        }),
      ),
    );
    const changed = vi.fn();
    render(<RecordingImportReview file={file()} onChange={changed} />);
    fireEvent.click(
      await screen.findByRole("radio", { name: /Budget review/ }),
    );
    await waitFor(() =>
      expect(changed.mock.lastCall?.[0].meetingId).toBe("target"),
    );
    fireEvent.change(screen.getByLabelText("When did it start?"), {
      target: { value: "2026-10-20T11:41" },
    });
    await waitFor(() => expect(changed.mock.lastCall?.[0].ready).toBe(false));
  });
  it("distinguishes failed lookup and keeps new meeting available", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<RecordingImportReview file={file()} onChange={vi.fn()} />);
    expect(
      await screen.findByText(/Could not load calendar meetings/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry calendar lookup" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("radio", { name: /Create a new meeting/ }),
    );
    expect(screen.getByLabelText("Meeting title")).toBeTruthy();
  });
  it("ignores an old calendar response after the date changes", async () => {
    let finishOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const changed = vi.fn();
    render(<RecordingImportReview file={file()} onChange={changed} />);
    await waitFor(() => expect(finishOld).toBeTypeOf("function"));
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          meetings: [
            {
              id: "new",
              title: "Correct day",
              startedAt: "2026-10-20T15:00:00Z",
              endedAt: null,
              unavailableReason: null,
            },
          ],
        }),
      ),
    );
    fireEvent.change(screen.getByLabelText("When did it start?"), {
      target: { value: "2026-10-20T11:00" },
    });
    await screen.findByRole("radio", { name: /Correct day/ });
    await act(async () =>
      finishOld(
        new Response(
          JSON.stringify({
            meetings: [
              {
                id: "old",
                title: "Wrong day",
                startedAt: "2026-10-19T15:00:00Z",
                endedAt: null,
                unavailableReason: null,
              },
            ],
          }),
        ),
      ),
    );
    expect(screen.queryByRole("radio", { name: /Wrong day/ })).toBeNull();
    expect(changed.mock.lastCall?.[0].ready).toBe(false);
  });

  it("never permits selecting an occupied calendar meeting", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          meetings: [
            {
              id: "target",
              title: "Budget review",
              startedAt: "2026-10-19T15:30:00Z",
              endedAt: null,
              unavailableReason: "Already has a recording",
            },
          ],
        }),
      ),
    );
    render(<RecordingImportReview file={file()} onChange={vi.fn()} />);
    expect(
      (
        (await screen.findByRole("radio", {
          name: /Budget review/,
        })) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("link", { name: /Open Budget review/ })
        .getAttribute("href"),
    ).toBe("/meetings/target");
  });
});

describe("local recording preview", () => {
  it("jumps a long recording and rejects invalid or out of range times", () => {
    render(<RecordingFilePreview file={file()} />);
    const media = screen.getByLabelText(
      "Recording preview",
    ) as HTMLMediaElement;
    Object.defineProperty(media, "duration", {
      value: 5127.9,
      configurable: true,
    });
    fireEvent.loadedMetadata(media);
    fireEvent.change(screen.getByLabelText("Jump to time"), {
      target: { value: "1:02:34" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(media.currentTime).toBe(3754);
    fireEvent.change(screen.getByLabelText("Jump to time"), {
      target: { value: "99:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(screen.getByRole("alert").textContent).toMatch(/within/);
    expect(media.currentTime).toBe(3754);
  });
  it("revokes local URLs and distinguishes codec failure from upload support", () => {
    const { unmount } = render(<RecordingFilePreview file={file()} />);
    fireEvent.error(screen.getByLabelText("Recording preview"));
    expect(screen.getByText(/You can still upload/)).toBeTruthy();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
