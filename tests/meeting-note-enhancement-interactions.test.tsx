// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingNotes } from "@/components/meeting-notes";
import type { NoteAnswer, NoteBlock } from "@/lib/meeting-note-document";

const props = { meetingId: "meeting-one", userId: "user-one" };
const revision = "a".repeat(64);
const answer = (
  question = "Check size?",
  text = "• Check size: $2M to $5M.",
): NoteAnswer => ({
  question,
  text,
  transcriptRevision: revision,
  sources: [
    {
      segmentId: "segment-one",
      quote: "Our checks are two to five million.",
      startMs: 62000,
      speaker: "Alex",
    },
  ],
});
let persisted: { content: string; version: number; blocks: NoteBlock[] };
let metadata: { transcriptRevision: string; hasTranscript: boolean };
let generate: import("vitest").Mock<(question: string) => Promise<Response>>;
const editor = () =>
  screen.getByRole("textbox", { name: "My notes" }) as HTMLTextAreaElement;
const posts = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/answer") && init?.method === "POST",
    );
async function open() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<MeetingNotes {...props} />);
  });
  return view;
}
async function pause(ms = 1400) {
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function seed(blocks: NoteBlock[]) {
  persisted = {
    blocks,
    content: blocks.map((b) => b.text).join("\n"),
    version: 4,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  seed([{ id: "first", text: "" }]);
  metadata = { transcriptRevision: revision, hasTranscript: true };
  generate = vi.fn(async (question: string) => Response.json(answer(question)));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (String(url).endsWith("/answer")) {
        if (init?.method === "POST")
          return generate(JSON.parse(String(init.body)).question);
        return Response.json(metadata);
      }
      if (init?.method === "PUT")
        persisted = {
          ...JSON.parse(String(init.body)),
          version: persisted.version + 1,
        };
      return Response.json(persisted);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("automatic transcript answers", () => {
  it("answers after a pause, includes sources, and persists without altering the question", async () => {
    await open();
    fireEvent.change(editor(), { target: { value: "Check size?" } });
    await pause(800);
    expect(posts()).toHaveLength(0);
    await pause(1400);
    expect(screen.getByDisplayValue("• Check size: $2M to $5M.")).toBeTruthy();
    expect(editor().value).toBe("Check size?");
    expect(posts()).toHaveLength(1);
    await pause(800);
    expect(persisted.blocks[0].answer?.text).toContain("$2M");
    expect(
      screen.getByRole("link", { name: /1:02 · Alex/ }).getAttribute("href"),
    ).toBe("#segment-one");
  });

  it("does not request answers for prose or during IME composition", async () => {
    await open();
    fireEvent.change(editor(), { target: { value: "A thought" } });
    await pause();
    expect(posts()).toHaveLength(0);
    fireEvent.compositionStart(editor());
    fireEvent.change(editor(), { target: { value: "投资方向？" } });
    await pause(2000);
    expect(posts()).toHaveLength(0);
    fireEvent.compositionEnd(editor());
    await pause();
    expect(posts()).toHaveLength(1);
  });

  it("keeps earlier answers when Enter starts another question and restores both after reload", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    const view = await open();
    fireEvent.change(editor(), {
      target: { value: "Check size?\nFocus?", selectionStart: 18 },
    });
    const second = screen.getByRole("textbox", { name: "Note 2" });
    expect(document.activeElement).toBe(second);
    await pause(1400);
    await pause(800);
    expect(persisted.blocks).toHaveLength(2);
    expect(persisted.blocks[0].answer?.question).toBe("Check size?");
    expect(persisted.blocks[1].answer?.question).toBe("Focus?");
    view.unmount();
    await open();
    await pause();
    expect(posts()).toHaveLength(1);
    expect(screen.getAllByText("From transcript")).toHaveLength(2);
  });

  it("ignores a late answer after the question changes", async () => {
    let finish!: (response: Response) => void;
    generate.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await open();
    fireEvent.change(editor(), { target: { value: "Old question?" } });
    await pause();
    expect(screen.getByText("Looking in transcript…")).toBeTruthy();
    fireEvent.change(editor(), { target: { value: "New question?" } });
    await act(async () =>
      finish(Response.json(answer("Old question?", "Stale answer"))),
    );
    expect(screen.queryByText("Stale answer")).toBeNull();
    await pause(1400);
    await pause(800);
    expect(persisted.blocks[0].answer?.question).toBe("New question?");
  });

  it("keeps the previous answer when regeneration fails and retries explicitly", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    await open();
    generate.mockResolvedValueOnce(Response.json({}, { status: 502 }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" })),
    );
    expect(screen.getByDisplayValue("• Check size: $2M to $5M.")).toBeTruthy();
    expect(
      screen.getByText("Could not answer. Your notes are safe."),
    ).toBeTruthy();
    await pause(3000);
    expect(posts()).toHaveLength(1);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Retry answer" })),
    );
    expect(posts()).toHaveLength(2);
  });

  it("protects edits made after a regeneration failure when retrying", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    await open();
    generate.mockResolvedValueOnce(Response.json({}, { status: 502 }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" })));
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "Correction after failure" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry answer" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(posts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep my answer" }));
    expect(screen.getByDisplayValue("Correction after failure")).toBeTruthy();
  });

  it("preserves edited answers on question change and confirms regeneration", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), {
      target: { value: "My correction" },
    });
    fireEvent.change(editor(), { target: { value: "" } });
    expect(screen.getByDisplayValue("My correction")).toBeTruthy();
    fireEvent.change(editor(), { target: { value: "Focus?" } });
    await pause();
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep my answer" }));
    expect(screen.getByDisplayValue("My correction")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" }));
    await act(async () =>
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Regenerate answer",
        }),
      ),
    );
    expect(screen.queryByDisplayValue("My correction")).toBeNull();
    await pause(300);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Answer" }));
  });

  it("directly edits and autosaves answers without edit or save buttons", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    const view = await open();
    const input = screen.getByRole("textbox", { name: "Answer" });
    expect(screen.queryByRole("button", { name: "Edit answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    const regenerate = screen.getByRole("button", { name: "Regenerate answer" });
    expect(regenerate.textContent).toBe("");
    expect(regenerate.parentElement).toBe(screen.getByText("From transcript").parentElement);
    fireEvent.change(input, { target: { value: "My correction" } });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await pause(800);
    expect(persisted.blocks[0].answer).toMatchObject({ text: "My correction", edited: true });
    view.unmount();
    await open();
    expect(screen.getByDisplayValue("My correction")).toBeTruthy();
  });

  it("persists an intentionally cleared answer without restoring or regenerating it", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    const view = await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "" } });
    await pause();
    expect(persisted.blocks[0].answer).toMatchObject({ text: "", edited: true });
    view.unmount();
    await open();
    await pause();
    expect((screen.getByRole("textbox", { name: "Answer" }) as HTMLTextAreaElement).value).toBe("");
    expect(posts()).toHaveLength(0);
  });

  it("recovers legacy unfinished edits and saves them by continuing to type", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    sessionStorage.setItem("meeting-notes-answer:user-one:meeting-one:first", JSON.stringify({text:"Recovered correction",baseText:answer().text}));
    await open();
    expect(screen.getByDisplayValue("Recovered correction")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "Recovered correction updated" } });
    await pause();
    expect(persisted.blocks[0].answer?.text).toBe("Recovered correction updated");
    expect(sessionStorage.getItem("meeting-notes-answer:user-one:meeting-one:first")).toBeNull();
  });

  it("prevents typing from racing an in flight regeneration", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    let finish!: (response: Response) => void;
    generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" }));
    const input = screen.getByRole("textbox", { name: "Answer" }) as HTMLTextAreaElement;
    expect(input.readOnly).toBe(true);
    fireEvent.change(input, { target: { value: "Racing edit" } });
    await act(async () => finish(Response.json(answer("Check size?", "Updated answer"))));
    expect(input.readOnly).toBe(false);
    expect(persisted.blocks[0].answer?.text).not.toBe("Racing edit");
    expect(input.value).toBe("Updated answer");
  });

  it("waits for transcript content then automatically answers", async () => {
    metadata.hasTranscript = false;
    await open();
    fireEvent.change(editor(), { target: { value: "Focus?" } });
    await pause();
    expect(
      screen.getByText("Will answer when the transcript is ready."),
    ).toBeTruthy();
    expect(posts()).toHaveLength(0);
    metadata = { transcriptRevision: revision, hasTranscript: true };
    await pause(31_000);
    await pause();
    expect(posts()).toHaveLength(1);
  });

  it("marks replaced transcript answers stale without silently regenerating", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    metadata.transcriptRevision = "b".repeat(64);
    await open();
    await pause();
    expect(screen.getByText(/Transcript updated/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Alex/ })).toBeNull();
  });

  it("keeps the last question answer attached when splitting legacy multiquestion text", async () => {
    seed([
      {
        id: "first",
        text: "Size?\nFocus?",
        answer: answer("Focus?", "Focus answer"),
      },
    ]);
    await open();
    fireEvent.change(editor(), {
      target: { value: "Size?\nFocus?\n", selectionStart: 14 },
    });
    await pause(800);
    expect(persisted.blocks[1].answer?.question).toBe("Focus?");
    expect(persisted.blocks[0].answer).toBeUndefined();
  });

  it("shows an explicit nonretryable size limit and leaves note saving available", async () => {
    generate.mockResolvedValueOnce(
      Response.json({ code: "TRANSCRIPT_TOO_LONG" }, { status: 413 }),
    );
    await open();
    fireEvent.change(editor(), { target: { value: "Check size?" } });
    await pause();
    expect(
      screen.getByText("This transcript is too long for automatic answers."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry answer" })).toBeNull();
    expect(persisted.content).toBe("Check size?");
  });

  it("does not generate while notes have a recovered save conflict", async () => {
    seed([{ id: "first", text: "Newer notes" }]);
    sessionStorage.setItem(
      "meeting-notes:user-one:meeting-one",
      JSON.stringify({ content: "Focus?", version: 1 }),
    );
    await open();
    await pause();
    expect(posts()).toHaveLength(0);
    expect(screen.getByText(/A newer version/)).toBeTruthy();
  });
  it("keeps an inline answer edit on its stable block when splitting", async () => {
    seed([
      {
        id: "first",
        text: "Size?\nFocus?",
        answer: answer("Focus?", "Focus answer"),
      },
    ]);
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), {
      target: { value: "Unfinished focus correction" },
    });
    fireEvent.change(editor(), {
      target: { value: "Size?\nFocus?\n", selectionStart: 14 },
    });
    expect(
      (
        screen.getByRole("textbox", {
          name: "Answer",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Unfinished focus correction");
    await pause(800);
    expect(persisted.blocks[1].id).toBe("first");
    expect(persisted.blocks[1].answer?.text).toBe("Unfinished focus correction");
  });

  it("rejects an answer that exceeds the total document budget without breaking saves", async () => {
    const blocks: NoteBlock[] = [{ id: "first", text: "" }];
    for (let i = 0; i < 16; i++)
      blocks.push({
        id: `saved-${i}`,
        text: `Earlier ${i}?`,
        answer: answer(`Earlier ${i}?`, "x".repeat(i < 15 ? 12_000 : 8_000)),
      });
    expect(JSON.stringify(blocks).length).toBeLessThan(200_000);
    seed(blocks);
    generate.mockResolvedValueOnce(
      Response.json(answer("New?", "z".repeat(12_000))),
    );
    await open();
    fireEvent.change(editor(), { target: { value: "New?" } });
    await pause();
    expect(screen.getByText(/These notes are full/)).toBeTruthy();
    await pause(800);
    expect(persisted.blocks[0].answer).toBeUndefined();
    expect(JSON.stringify(persisted.blocks).length).toBeLessThan(200_000);
    expect(
      screen.queryByText("Could not save. Your edits are still here."),
    ).toBeNull();
  });

  it("removes an answer only after explicitly clearing its question and choosing Remove answer", async () => {
    seed([{ id: "first", text: "Check size?", answer: answer() }]);
    await open();
    fireEvent.change(editor(), { target: { value: "" } });
    expect(screen.getByDisplayValue("• Check size: $2M to $5M.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove answer" }));
    await pause();
    expect(persisted.blocks[0].answer).toBeUndefined();
    expect(posts()).toHaveLength(0);
  });
});
