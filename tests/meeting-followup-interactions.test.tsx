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
  research: [],
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
  meetingTitle: "AI Investment Discussion",
  meetingStartedAt: "2026-10-29T01:30:00Z",
  sourceHash: "a".repeat(64),
  segments: [
    { id: "one", startMs: 120000, speaker: "Momir Amidzic" },
    { id: "two", startMs: 186000, speaker: "Kezhen Chen" },
  ],
};
const research = {
  question: "What evidence supports the savings claim?",
  context: "Momir requested benchmark evidence before the investment discussion.",
  evidenceToCollect: "Compare cost and success rate on representative tasks.",
  evidence: [{ segmentId: "one", quote: "We will discuss at IC tomorrow." }],
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
  it("copies a complete research prompt for a shared reader and confirms only after success", async () => {
    let resolve!: () => void;
    const writeText = vi.fn().mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MeetingFollowup {...props} canGenerate={false} initialResult={{ ...result, research: [research] }} />);
    const copyButton = screen.getByRole("button", { name: `Copy research prompt: ${research.question}` });
    expect(document.getElementById(copyButton.getAttribute("aria-describedby")!)?.textContent).toBe(research.evidenceToCollect);
    const liveRegions = screen.getAllByRole("status");
    fireEvent.click(screen.getByRole("button", { name: `Copy research prompt: ${research.question}` }));
    expect(screen.queryByText("Research prompt copied")).toBeNull();
    const copied = writeText.mock.calls[0][0];
    for (const text of [research.question, research.context, research.evidenceToCollect, props.meetingTitle, props.meetingStartedAt, "/meetings/meeting-one", "Momir Amidzic at 2:00", research.evidence[0].quote, "primary sources", "unverified"]) {
      expect(copied).toContain(text);
    }
    expect(copied).not.toContain("We are raising.");
    await act(async () => resolve());
    const status = screen.getByText("Research prompt copied").closest('[role="status"]');
    expect(liveRegions).toContain(status);
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
  });

  it("reports clipboard failure without claiming success and allows retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MeetingFollowup {...props} initialResult={{ ...result, research: [research] }} />);
    const button = screen.getByRole("button", { name: `Copy research prompt: ${research.question}` });
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not copy");
    expect(screen.queryByText("Research prompt copied")).toBeNull();
    fireEvent.click(button);
    await screen.findByText("Research prompt copied");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps source controls separate from copying and hides research when empty", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { rerender } = render(<MeetingFollowup {...props} initialResult={{ todos: [], dynamics: [], research: [research] }} />);
    fireEvent.click(screen.getByRole("button", { name: "View source at 2:00" }));
    await screen.findByRole("dialog");
    expect(writeText).not.toHaveBeenCalled();
    rerender(<MeetingFollowup {...props} key="empty" initialResult={result} />);
    expect(screen.queryByText("Potential research")).toBeNull();
  });

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
    expect(screen.getAllByRole("status").some((status) => status.textContent === "Followup ready.")).toBe(true);
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
