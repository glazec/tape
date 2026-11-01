// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MeetingNotes } from "@/components/meeting-notes";
import { meetingNoteSchema } from "@/lib/meeting-note-document";
const props = {
  meetingId: "one",
  userId: "user",
  momentSources: [
    {
      id: "one",
      durationMs: null,
      recordings: [],
      hasTranscript: false,
      recording: true,
    },
  ],
};
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ content: "", version: 0 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("captures @now with Space, preserves the anchor while typing, and saves it", async () => {
  render(<MeetingNotes {...props} />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.change(editor, { target: { value: "@now", selectionStart: 4 } });
  fireEvent.keyDown(editor, { key: " " });
  expect(editor.value).toBe("[Moment] ");
  fireEvent.change(editor, {
    target: { value: "[Moment] Budget", selectionStart: 15 },
  });
  fireEvent.blur(editor);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "PUT" }),
    ),
  );
  const saved = JSON.parse(
    vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === "PUT")![1]!
      .body as string,
  );
  expect(saved.blocks[0].moments[0]).toMatchObject({
    start: 0,
    text: "[Moment]",
    sourceMeetingId: "one",
  });
  expect(Date.parse(saved.blocks[0].moments[0].capturedAt)).toBeGreaterThan(0);
});
it("does not convert pasted @now or active composition and reports unavailable timing", async () => {
  render(<MeetingNotes meetingId="one" userId="user" />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.change(editor, { target: { value: "@now ", selectionStart: 5 } });
  expect(editor.value).toBe("@now ");
  fireEvent.change(editor, { target: { value: "@now", selectionStart: 4 } });
  fireEvent.compositionStart(editor);
  fireEvent.keyDown(editor, { key: " " });
  expect(editor.value).toBe("@now");
  fireEvent.compositionEnd(editor);
  fireEvent.keyDown(editor, { key: " " });
  expect(
    screen.getByText(/Current recording time is unavailable/),
  ).toBeTruthy();
});
it("renders saved timestamps once and dispatches only their owning source", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ content: "[0:30] Budget", version: 1 }),
  );
  const navigate = vi.fn();
  window.addEventListener("tape:note-moment", navigate);
  render(
    <MeetingNotes
      {...props}
      momentSources={[
        {
          ...props.momentSources[0],
          recording: false,
          hasTranscript: true,
          durationMs: 60000,
        },
      ]}
    />,
  );
  const marker = await screen.findByRole("button", {
    name: "Go to 0:30 in transcript",
  });
  fireEvent.click(marker);
  expect(navigate.mock.calls[0][0].detail).toMatchObject({
    meetingId: "one",
    timestampMs: 30000,
  });
  expect(screen.queryByRole("textbox", { name: "My notes" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit notes" }));
  expect(
    (screen.getByRole("textbox", { name: "My notes" }) as HTMLTextAreaElement)
      .value,
  ).toBe("[0:30] Budget");
  window.removeEventListener("tape:note-moment", navigate);
});
it("restores a captured moment after stopping and resolves through a resumed recording", async () => {
  const block = {
    id: "saved",
    text: "[Moment] Budget",
    moments: [
      {
        start: 0,
        text: "[Moment]",
        sourceMeetingId: "one",
        capturedAt: "2026-10-31T10:10:30Z",
      },
    ],
  };
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ content: block.text, blocks: [block], version: 1 }),
  );
  render(
    <MeetingNotes
      {...props}
      momentSources={[
        {
          ...props.momentSources[0],
          recording: false,
          hasTranscript: true,
          durationMs: 180000,
          recordings: [
            {
              startedAt: "2026-10-31T10:00:00Z",
              endedAt: "2026-10-31T10:02:00Z",
              durationMs: 120000,
            },
            {
              startedAt: "2026-10-31T10:10:00Z",
              endedAt: "2026-10-31T10:11:00Z",
              durationMs: 60000,
            },
          ],
        },
      ]}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Go to 2:30 in transcript" }),
  ).toBeTruthy();
});
it("keeps capture metadata when a question splits the writing block", async () => {
  render(<MeetingNotes {...props} />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.change(editor, { target: { value: "@now", selectionStart: 4 } });
  fireEvent.keyDown(editor, { key: " " });
  fireEvent.change(editor, {
    target: { value: "[Moment] Budget?\nNext", selectionStart: 20 },
  });
  const draft = JSON.parse(sessionStorage.getItem("meeting-notes:user:one")!);
  expect(draft.blocks).toHaveLength(2);
  expect(draft.blocks[0].moments[0]).toMatchObject({
    start: 0,
    text: "[Moment]",
  });
  expect(draft.blocks[1].text).toBe("Next");
});
it("does not convert a pasted command when Space is typed", async () => {
  render(<MeetingNotes {...props} />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.paste(editor);
  fireEvent.change(editor, { target: { value: "@now", selectionStart: 4 } });
  expect(fireEvent.keyDown(editor, { key: " " })).toBe(true);
  expect(editor.value).toBe("@now");
});
it("uses the Add timestamp button at the active caret", async () => {
  render(<MeetingNotes {...props} />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.focus(editor);
  fireEvent.change(editor, {
    target: { value: "Budget", selectionStart: 0, selectionEnd: 0 },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  expect(editor.value).toBe("[Moment] Budget");
  expect(editor.selectionStart).toBe(9);
});
it("captures a desktop moment before the meeting status reflects its recording", async () => {
  render(
    <MeetingNotes
      {...props}
      momentSources={[{ ...props.momentSources[0], recording: false }]}
    />,
  );
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  expect(editor.value).toBe("[Moment] ");
  expect(
    screen.getByText(/It will link if this time is covered by a recording/),
  ).toBeTruthy();
});
it("captures playback at a known position even when the source duration is unavailable", async () => {
  render(
    <MeetingNotes
      {...props}
      momentSources={[{ ...props.momentSources[0], recording: false }]}
    />,
  );
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  window.dispatchEvent(
    new CustomEvent("tape:note-playback-position", {
      detail: { meetingId: "one", timestampMs: 30000 },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  expect(editor.value).toBe("[0:30] ");
  expect(
    JSON.parse(sessionStorage.getItem("meeting-notes:user:one")!).blocks[0]
      .moments[0],
  ).toMatchObject({ playbackMs: 30000, sourceMeetingId: "one" });
});
it("inserts an identical marker before an existing marker without duplicating its anchor position", async () => {
  render(<MeetingNotes {...props} />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  const first = JSON.parse(sessionStorage.getItem("meeting-notes:user:one")!)
    .blocks[0].moments[0];
  editor.setSelectionRange(0, 0);
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  expect(editor.value).toBe("[Moment] [Moment] ");
  const block = JSON.parse(sessionStorage.getItem("meeting-notes:user:one")!)
    .blocks[0];
  expect(
    block.moments
      .map((moment: { start: number }) => moment.start)
      .sort((a: number, b: number) => a - b),
  ).toEqual([0, 9]);
  expect(
    block.moments.find((moment: { start: number }) => moment.start === 9),
  ).toEqual({ ...first, start: 9 });
  expect(
    meetingNoteSchema.safeParse({
      content: block.text,
      version: 0,
      blocks: [block],
    }).success,
  ).toBe(true);
  fireEvent.blur(editor);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "PUT" }),
    ),
  );
});
it("replaces a selected marker and preserves the neighboring identical marker", async () => {
  render(<MeetingNotes {...props} />);
  const editor = screen.getByRole("textbox", {
    name: "My notes",
  }) as HTMLTextAreaElement;
  await waitFor(() => expect(editor.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  const before = JSON.parse(sessionStorage.getItem("meeting-notes:user:one")!)
    .blocks[0].moments;
  editor.setSelectionRange(0, 9);
  fireEvent.click(screen.getByRole("button", { name: "Add timestamp" }));
  const block = JSON.parse(sessionStorage.getItem("meeting-notes:user:one")!)
    .blocks[0];
  expect(block.moments).toHaveLength(2);
  expect(
    block.moments.find((moment: { start: number }) => moment.start === 9),
  ).toEqual(before[1]);
});
