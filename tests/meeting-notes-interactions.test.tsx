// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MeetingNotes } from "@/components/meeting-notes";

const props = { meetingId: "meeting-one", userId: "user-one" };
const key = "meeting-notes:user-one:meeting-one";
const response = (content = "", version = 0, status = 200) =>
  Response.json({ content, version }, { status });
const editor = () =>
  screen.getByRole("textbox", { name: "My notes" }) as HTMLTextAreaElement;
async function open() {
  const view = render(<MeetingNotes {...props} />);
  await waitFor(() => expect(editor().disabled).toBe(false));
  return view;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("meeting notes editor", () => {
  it("loads existing notes and explains privacy", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response("Existing notes", 4));
    await open();
    expect(editor().value).toBe("Existing notes");
    expect(screen.getByText("Only visible to you")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("autosaves after typing and retains the draft across page refresh renders", async () => {
    const view = await open();
    vi.mocked(fetch).mockResolvedValueOnce(
      response("Question for the team", 1),
    );
    fireEvent.change(editor(), { target: { value: "Question for the team" } });
    view.rerender(<MeetingNotes {...props} />);
    expect(editor().value).toBe("Question for the team");
    expect(sessionStorage.getItem(key)).toContain("Question for the team");
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/notes"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          content: "Question for the team",
          blocks: [{ id: "legacy", text: "Question for the team" }],
          version: 0,
        }),
      }),
    );
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("serializes saves while allowing typing during an in flight request", async () => {
    await open();
    let resolveSave!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValueOnce(response("Second draft", 2));
    fireEvent.change(editor(), { target: { value: "First draft" } });
    fireEvent.blur(editor());
    fireEvent.change(editor(), { target: { value: "Second draft" } });
    fireEvent.blur(editor());
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => resolveSave(response("First draft", 1)));
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          content: "Second draft",
          blocks: [{ id: "legacy", text: "Second draft" }],
          version: 1,
        }),
      }),
    );
    expect(editor().value).toBe("Second draft");
  });

  it("preserves edits on network failure and retries", async () => {
    await open();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(editor(), { target: { value: "Keep this" } });
    fireEvent.blur(editor());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(editor().value).toBe("Keep this");
    expect(sessionStorage.getItem(key)).toContain("Keep this");
    vi.mocked(fetch).mockResolvedValueOnce(response("Keep this", 1));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("recovers a local draft after leaving and returning", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "Recovered", version: 0 }),
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response("Recovered", 1));
    await open();
    expect(editor().value).toBe("Recovered");
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("blocks conflicting saves and supports explicitly loading the newer version", async () => {
    await open();
    vi.mocked(fetch).mockResolvedValueOnce(response("", 0, 409));
    fireEvent.change(editor(), { target: { value: "My draft" } });
    fireEvent.blur(editor());
    expect(
      await screen.findByText(/A newer version was saved in another tab/),
    ).toBeTruthy();
    fireEvent.blur(editor());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(editor().value).toBe("My draft");
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer saved notes", 2));
    fireEvent.click(screen.getByRole("button", { name: "Load saved notes" }));
    const dialog = await screen.findByRole("dialog");
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Load saved notes" }),
    );
    await waitFor(() => expect(editor().value).toBe("Newer saved notes"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not overwrite a newer remote note with a recovered stale draft", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "Old draft", version: 1 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer notes", 2));
    await open();
    expect(
      screen.getByText(/A newer version was saved in another tab/),
    ).toBeTruthy();
    expect(editor().value).toBe("Old draft");
    fireEvent.blur(editor());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lets users copy a conflicting draft and cancel replacement", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "My draft", version: 1 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer notes", 2));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Copy my edits" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Load saved notes" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Keep my edits",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(editor().value).toBe("My draft");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("selects the draft for manual copying when clipboard access fails", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "My draft", version: 1 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer notes", 2));
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Copy my edits" }));
    expect(
      await screen.findByText(/Could not copy automatically/),
    ).toBeTruthy();
    expect(editor().selectionStart).toBe(0);
    expect(editor().selectionEnd).toBe("My draft".length);
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("does not claim new edits were copied while the clipboard request was pending", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "My draft", version: 1 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer notes", 2));
    let finishCopy!: () => void;
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              finishCopy = resolve;
            }),
        ),
      },
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Copy my edits" }));
    fireEvent.change(editor(), { target: { value: "Updated draft" } });
    await act(async () => finishCopy());
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(editor().value).toBe("Updated draft");
  });

  it("shows the length limit only when notes approach it", async () => {
    await open();
    expect(screen.queryByText(/characters remaining/)).toBeNull();
    fireEvent.change(editor(), { target: { value: "x".repeat(19_900) } });
    expect(screen.getByText("100 characters remaining")).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce(response("x".repeat(19_900), 1));
    fireEvent.blur(editor());
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("removes a local draft when its earlier save already reached the server", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "Saved despite disconnect", version: 1 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      response("Saved despite disconnect", 2),
    );
    await open();
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retries an initial load failure without accepting edits first", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    render(<MeetingNotes {...props} />);
    expect(await screen.findByText("Could not load your notes.")).toBeTruthy();
    expect(editor().disabled).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(response("Loaded", 2));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(editor().value).toBe("Loaded"));
  });

  it("keeps a recovered conflict blocked after further editing and reopening", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ content: "Old draft", version: 1 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer notes", 2));
    const view = await open();
    fireEvent.change(editor(), { target: { value: "Old draft plus edits" } });
    expect(JSON.parse(sessionStorage.getItem(key)!).version).toBe(1);
    view.unmount();
    vi.mocked(fetch).mockResolvedValueOnce(response("Newer notes", 2));
    await open();
    expect(
      screen.getByText(/A newer version was saved in another tab/),
    ).toBeTruthy();
    expect(editor().value).toBe("Old draft plus edits");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears existing notes and warns before leaving with unsaved changes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response("Existing", 3));
    await open();
    fireEvent.change(editor(), { target: { value: "" } });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(response("", 4));
    fireEvent.blur(editor());
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          content: "",
          blocks: [{ id: "legacy", text: "" }],
          version: 3,
        }),
      }),
    );
  });
});
