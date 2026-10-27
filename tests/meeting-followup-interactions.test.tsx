// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { MeetingFollowup } from "@/components/meeting-followup";

const result = {
  todos: [
    {
      person: "Momir Amidzic",
      text: "Momir Amidzic's team will discuss at IC.",
      timing: "tomorrow",
      evidence: [
        { segmentId: "one", quote: "We will discuss at IC tomorrow." },
      ],
    },
  ],
  dynamics: [
    {
      person: "Kezhen Chen",
      text: "Kezhen Chen's company seeks funding.",
      evidence: [{ segmentId: "two", quote: "We are raising." }],
    },
  ],
};
const props = {
  canGenerate: true,
  initialResult: null,
  meetingId: "meeting-one",
  sourceHash: "a".repeat(64),
  segments: [
    { id: "one", startMs: 120000 },
    { id: "two", startMs: 186000 },
  ],
};
// The followup is always open now; keep the helper so each test still reads
// as "open the followup, then act".
const open = () => {
  expect(screen.getByRole("heading", { name: "AI followup" })).toBeTruthy();
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("meeting followup interaction", () => {
  it("generates on demand, displays explicit names and links to transcript evidence", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ result }));
    vi.stubGlobal("fetch", fetch);
    render(<MeetingFollowup {...props} />);
    expect(fetch).not.toHaveBeenCalled();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Generate followup" }));
    await screen.findByText("@Momir Amidzic");
    expect(screen.getByText("To do list")).toBeTruthy();
    expect(screen.getByText("Dynamic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View source at 2:00" }));
    expect(await screen.findByText("“We will discuss at IC tomorrow.”")).toBeTruthy();
    const transcriptLink = screen.getByRole("link", { name: "View in transcript" });
    expect(transcriptLink.getAttribute("href")).toBe("#one");
    fireEvent.click(transcriptLink);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      sourceHash: props.sourceHash,
    });
    expect(screen.getByRole("status").textContent).toBe("Followup ready.");
  });

  it("shows the exact source on hover and dismisses with Escape", async () => {
    render(<MeetingFollowup {...props} initialResult={result} />);
    open();
    const source = screen.getByRole("button", { name: "View source at 2:00" });
    fireEvent.pointerEnter(source, { pointerType: "mouse" });
    fireEvent.mouseEnter(source);
    fireEvent.mouseMove(source);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("“We will discuss at IC tomorrow.”")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const regenerate = screen.getByRole("button", { name: "Regenerate" });
    expect(regenerate.getAttribute("title")).toBe("Regenerate followup");
    expect(regenerate.querySelector("span")?.className).toBe("sr-only");
  });

  it("shows saved results to readers without generation controls", () => {
    render(
      <MeetingFollowup {...props} canGenerate={false} initialResult={result} />,
    );
    open();
    expect(screen.getByText("@Kezhen Chen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(screen.getByRole("button", { name: "View source at 2:00" })).toBeTruthy();
  });

  it("hides empty followup from readers", () => {
    const { container } = render(
      <MeetingFollowup {...props} canGenerate={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("preserves a previous valid result on provider failure and offers Retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Could not generate the followup. Please try again." },
            { status: 502 },
          ),
        ),
    );
    render(<MeetingFollowup {...props} initialResult={result} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "try again",
    );
    expect(screen.getByText("@Momir Amidzic")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("removes stale results and refreshes after a source or access change", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "The transcript changed." }, { status: 409 }),
        ),
    );
    render(<MeetingFollowup {...props} initialResult={result} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("@Momir Amidzic")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("blocks duplicate clicks and cancels UI updates when changing meetings", async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(<MeetingFollowup {...props} />);
    open();
    const button = screen.getByRole("button", { name: "Generate followup" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: "Generating followup…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    unmount();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve(Response.json({ result })));
  });

  it("shows truthful empty results", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ result: { todos: [], dynamics: [] } }),
        ),
    );
    render(<MeetingFollowup {...props} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Generate followup" }));
    await waitFor(() =>
      expect(screen.getByText("No explicit next actions.")).toBeTruthy(),
    );
    expect(screen.getByText("No explicit offers or needs.")).toBeTruthy();
  });
});
