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
import { SPEAKER_LABELS_CHANGED, type MeetingConnection } from "@/lib/meeting-connections";

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
    { id: "one", startMs: 120000, speaker: "Momir Amidzic", text: "We will discuss at IC tomorrow." },
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
  expect(screen.getByRole("heading", { name: "From the transcript" })).toBeTruthy();
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("meeting followup interaction", () => {
  const connection: MeetingConnection = {
    kind: "team", name: null, company: "Citi", title: null,
    context: "Works with the debt financing team.", relationship: "works_with",
    speakerSegmentId: "one", evidence: [{ segmentId: "one" }],
  };

  it("shows external speakers before the current organization and displays mutual markers", () => {
    render(<MeetingFollowup {...props} initialConnections={[connection, { ...connection, name: "Contact", speakerSegmentId: "two", mutual: true }]} organizationDomains={["internal.test"]} participants={[{ name: "Momir Amidzic", email: "momir@internal.test" }, { name: "Kezhen Chen", email: "kezhen@external.test" }]} />);
    expect(screen.getAllByRole("heading", { level: 4 }).map(element => element.textContent)).toEqual(["@Kezhen Chen", "@Momir Amidzic"]);
    expect(screen.getByText("Mutual connection")).toBeTruthy();
  });

  it("saves a correction and moves the connection to the chosen speaker", async () => {
    const corrected = { ...connection, name: "Corrected contact", context: "Corrected description", speakerSegmentId: "two", mutual: true };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ connections: [corrected], revision: "b".repeat(64) }));
    vi.stubGlobal("fetch", fetcher);
    render(<MeetingFollowup {...props} initialConnections={[connection]} initialConnectionsRevision={"a".repeat(64)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit connection: Citi" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Corrected contact" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Corrected description" } });
    fireEvent.change(screen.getByLabelText("Mentioned by"), { target: { value: "two" } });
    fireEvent.click(screen.getByLabelText("Mutual connection"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "@Kezhen Chen" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "@Momir Amidzic" })).toBeNull();
    expect(screen.getByRole("link", { name: "Corrected contact" })).toBeTruthy();
    const input = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(input).toMatchObject({ index: 0, revision: "a".repeat(64), changes: { context: "Corrected description", speakerSegmentId: "two", mutual: true } });
    fireEvent.click(screen.getByRole("button", { name: "Edit connection: Corrected contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe("b".repeat(64));
  });

  it("recovers a conflict with a reordered latest list and keeps the draft through a server refresh", async () => {
    const other = { ...connection, name: "Other contact" };
    const latest = { ...connection, context: "Someone else's correction" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Connections changed" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ connections: [other, latest], connectionIds: ["other", "target"], revision: "b".repeat(64) }))
      .mockResolvedValueOnce(Response.json({ connections: [other, { ...latest, context: "My draft" }], connectionIds: ["other", "target"], revision: "c".repeat(64) }));
    vi.stubGlobal("fetch", fetcher);
    const input = { ...props, initialConnections: [connection], initialConnectionIds: ["target"], initialConnectionsRevision: "a".repeat(64) };
    const view = render(<MeetingFollowup {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit connection: Citi" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "My draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("alert");
    view.rerender(<MeetingFollowup {...input} initialConnections={[other, latest]} initialConnectionIds={["other", "target"]} initialConnectionsRevision={"b".repeat(64)} />);
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Load latest version" }));
    await screen.findByText("Latest saved version");
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ index: 1, revision: "b".repeat(64), changes: { context: "My draft" } });
  });

  it("applies a deferred server snapshot when the user cancels editing", () => {
    const view = render(<MeetingFollowup {...props} initialConnections={[connection]} initialConnectionsRevision={"a".repeat(64)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit connection: Citi" }));
    view.rerender(<MeetingFollowup {...props} initialConnections={[{ ...connection, name: "New saved name" }]} initialConnectionsRevision={"b".repeat(64)} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit connection: New saved name" })).toBeTruthy();
  });

  it("respects another user's speaker rename after the local rename is acknowledged", () => {
    const input = { ...props, initialConnections: [connection] };
    const view = render(<MeetingFollowup {...input} />);
    act(() => window.dispatchEvent(new CustomEvent(SPEAKER_LABELS_CHANGED, { detail: [{ id: "one", speaker: "Local name" }] })));
    view.rerender(<MeetingFollowup {...input} segments={[{ ...props.segments[0], speaker: "Local name" }, props.segments[1]]} />);
    view.rerender(<MeetingFollowup {...input} segments={[{ ...props.segments[0], speaker: "Server name" }, props.segments[1]]} />);
    expect(screen.getByRole("heading", { name: "@Server name" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "@Local name" })).toBeNull();
  });

  it("updates organization order on identification and preserves identity through aliases and rollback", () => {
    render(<MeetingFollowup {...props} segments={[{ ...props.segments[0], speaker: "Speaker 1" }, props.segments[1]]}
      initialConnections={[connection, { ...connection, speakerSegmentId: "two" }]} organizationDomains={["internal.test"]}
      participants={[{ name: "Internal", email: "person@internal.test" }]} />);
    const names = () => screen.getAllByRole("heading", { level: 4 }).map(element => element.textContent);
    const change = (speaker: string, participantEmail?: string) => act(() => window.dispatchEvent(new CustomEvent(SPEAKER_LABELS_CHANGED, { detail: [{ id: "one", speaker, participantEmail }] })));
    change("Internal", "person@internal.test");
    expect(names()).toEqual(["@Kezhen Chen", "@Internal"]);
    change("Nickname");
    expect(names()).toEqual(["@Kezhen Chen", "@Nickname"]);
    change("External", "external@outside.test");
    expect(names()).toEqual(["@External", "@Kezhen Chen"]);
    change("Nickname", "person@internal.test");
    expect(names()).toEqual(["@Kezhen Chen", "@Nickname"]);
  });

  it("keeps an unsaved draft on failure and hides edit controls from readers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Connections changed. Reload before saving." }, { status: 409 })));
    const view = render(<MeetingFollowup {...props} initialConnections={[connection]} initialConnectionsRevision={"a".repeat(64)} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit connection: Citi" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Connections changed"));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Keep this draft");
    expect(screen.getByText(connection.context)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    view.unmount();
    render(<MeetingFollowup {...props} canGenerate={false} initialConnections={[connection]} initialConnectionsRevision={"a".repeat(64)} />);
    expect(screen.queryByRole("button", { name: "Edit connection: Citi" })).toBeNull();
  });

  it("shows saved connections when other summaries became stale after a rename, including for readers", () => {
    render(<MeetingFollowup {...props} canGenerate={false} initialConnections={[connection]} />);
    expect(screen.getByText("Potential connections")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "@Momir Amidzic" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Unnamed team" }).getAttribute("href")).toBe("#one");
    expect(screen.getByText("Works with")).toBeTruthy();
    expect(screen.queryByText("To do list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate followup" })).toBeNull();
  });

  it("updates only referenced speaker groups optimistically, ignores other meetings, and rolls back", () => {
    render(<MeetingFollowup {...props} initialConnections={[connection, { ...connection, name: "Other team", speakerSegmentId: "two" }]} />);
    const update = (id: string, speaker: string) => act(() => {
      window.dispatchEvent(new CustomEvent(SPEAKER_LABELS_CHANGED, { detail: [{ id, speaker }] }));
    });
    update("foreign-segment", "Wrong meeting");
    expect(screen.queryByText("@Wrong meeting")).toBeNull();
    update("one", "Alice");
    expect(screen.getByRole("heading", { name: "@Alice" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "@Kezhen Chen" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "@Momir Amidzic" })).toBeNull();
    update("one", "Momir Amidzic");
    expect(screen.getByRole("heading", { name: "@Momir Amidzic" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "@Alice" })).toBeNull();
  });

  it("keeps long connection lists behind a disclosure and source quotes accessible", async () => {
    render(<MeetingFollowup {...props} initialConnections={Array.from({ length: 5 }, (_, index) => ({ ...connection, name: `Team ${index}` }))} />);
    const summary = screen.getByText("Show 2 more connections");
    expect(summary.closest("details")?.open).toBe(false);
    fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "View source at 2:00" })[0]);
    expect(await screen.findByText("“We will discuss at IC tomorrow.”")).toBeTruthy();
  });

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

  it("auto generates once when no followup exists", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ result }));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<MeetingFollowup {...props} autoGenerate />);
    expect(screen.getByText("Writing followup from the transcript…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate followup" })).toBeNull();
    await screen.findByText("@Momir Amidzic");
    rerender(<MeetingFollowup {...props} autoGenerate />);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("waits for the background job before generating a just finished transcript", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(Response.json({ result }));
    vi.stubGlobal("fetch", fetch);
    render(<MeetingFollowup {...props} autoGenerate waitForBackground />);
    expect(screen.getByText("Writing followup from the transcript…")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not auto generate when a followup already exists", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<MeetingFollowup {...props} autoGenerate initialResult={result} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetch).not.toHaveBeenCalled();
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
