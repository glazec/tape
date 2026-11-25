// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonNotes, notePermalink } from "@/components/person-notes";
import type { PersonNote } from "@/lib/person-notes";

const note = (id: string, extra: Partial<PersonNote> = {}): PersonNote => ({
  id, body: `Note ${id}`, authorName: "Riley Ng", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", canEdit: false, ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

async function openActions(name: RegExp) {
  const trigger = screen.getByRole("button", { name });
  await act(async () => {
    fireEvent.click(trigger);
  });
  return waitFor(() => screen.getByRole("menu"));
}

describe("PersonNotes", () => {
  it("shows an empty state and adds a note with Command Enter, keeping line breaks", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => Response.json({
      note: note("new", { body: JSON.parse(String(init.body)).body, authorName: "Yiping Lu", canEdit: true }),
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[]} personId="dana" personName="Dana Whitfield" />);
    expect(screen.getByText(/No notes yet/)).toBeTruthy();
    expect(screen.getByText("Shared with your workspace")).toBeTruthy();

    const composer = screen.getByLabelText("Add a note about Dana Whitfield") as HTMLTextAreaElement;
    expect(composer.maxLength).toBe(4000);
    act(() => composer.focus());
    expect((screen.getByRole("button", { name: "Add note" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(composer, { target: { value: "  First line\nSecond line  " } });
    fireEvent.keyDown(composer, { key: "Enter", metaKey: true });

    await waitFor(() => expect(screen.getByText(/First line/)).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/people/dana/notes", expect.objectContaining({ method: "POST", body: JSON.stringify({ body: "First line\nSecond line" }) }));
    expect(screen.getByText(/First line/).textContent).toBe("First line\nSecond line");
    expect(composer.value).toBe("");
    expect(document.getElementById("note-new")).toBeTruthy();
  });

  it("keeps the draft and offers Try again when adding fails", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Person not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ note: note("ok", { body: "Call before Friday" }) }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[]} personId="dana" personName="Dana Whitfield" />);
    const composer = screen.getByLabelText("Add a note about Dana Whitfield") as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "Call before Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Person not found"));
    expect(composer.value).toBe("Call before Friday");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Call before Friday", { selector: "p" })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("links every note to its permalink and offers Edit and Delete only to the author", async () => {
    render(<PersonNotes initialNotes={[note("mine", { canEdit: true, authorName: "Yiping Lu" }), note("theirs")]} personId="dana" personName="Dana Whitfield" />);
    expect(notePermalink("dana", "mine")).toBe("/people/dana#note-mine");
    expect(document.querySelector('a[href="/people/dana#note-theirs"]')).toBeTruthy();

    let menu = await openActions(/Note actions, Riley Ng/);
    expect(within(menu).getByRole("menuitem", { name: /Copy link/ })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: /Edit/ })).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });

    menu = await openActions(/Note actions, Yiping Lu/);
    expect(within(menu).getByRole("menuitem", { name: /Edit/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Delete/ })).toBeTruthy();
  });

  it("edits a note, cancels with Escape and saves with Command Enter", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => Response.json({
      note: note("mine", { canEdit: true, body: JSON.parse(String(init.body)).body, updatedAt: "2026-11-02T10:00:00.000Z" }),
    }));
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[note("mine", { canEdit: true })]} personId="dana" personName="Dana Whitfield" />);

    let menu = await openActions(/Note actions/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Edit/ }));
    let editor = await waitFor(() => screen.getByLabelText("Edit note") as HTMLTextAreaElement);
    fireEvent.change(editor, { target: { value: "Changed then abandoned" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByLabelText("Edit note")).toBeNull();
    expect(screen.getByText("Note mine")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    menu = await openActions(/Note actions/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Edit/ }));
    editor = await waitFor(() => screen.getByLabelText("Edit note") as HTMLTextAreaElement);
    fireEvent.change(editor, { target: { value: "Updated body" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(screen.getByText("Updated body")).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith("/api/people/dana/notes/mine", expect.objectContaining({ method: "PATCH" }));
    expect(screen.getByText("Edited")).toBeTruthy();
  });

  it("returns keyboard focus to the note after saving an unchanged edit", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[note("mine", { canEdit: true })]} personId="dana" personName="Dana Whitfield" />);
    const menu = await openActions(/Note actions/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    const editor = await screen.findByRole("textbox", { name: "Edit note" });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("note-mine")));
    expect(screen.queryByRole("textbox", { name: "Edit note" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns keyboard focus to the note when canceling deletion", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[note("mine", { canEdit: true })]} personId="dana" personName="Dana Whitfield" />);
    const menu = await openActions(/Note actions/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("note-mine")));
    expect(screen.queryByRole("group", { name: "Confirm delete" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows visible confirmation on the note after copying its link", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<PersonNotes initialNotes={[note("mine")]} personId="dana" personName="Dana Whitfield" />);
    const menu = await openActions(/Note actions/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    const row = document.getElementById("note-mine")!;
    expect(await within(row).findByText("Link copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/people/dana#note-mine"));
    writeText.mockRestore();
  });

  it("confirms before deleting and retries after a failure", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Could not delete the note." }, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[note("mine", { canEdit: true })]} personId="dana" personName="Dana Whitfield" />);

    const menu = await openActions(/Note actions/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    expect(await screen.findByText("Delete this note for everyone?")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not delete the note."));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Note mine")).toBeNull());
    expect(fetch).toHaveBeenLastCalledWith("/api/people/dana/notes/mine", { method: "DELETE" });
    expect(screen.getByText(/No notes yet/)).toBeTruthy();
  });

  it("keeps the list short and opens it for a permalinked older note", async () => {
    const many = Array.from({ length: 8 }, (_, index) => note(`n${index}`));
    window.location.hash = "#note-n7";
    render(<PersonNotes initialNotes={many} personId="dana" personName="Dana Whitfield" />);
    await waitFor(() => expect(screen.getByText("Note n7")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();

    cleanup();
    window.location.hash = "";
    render(<PersonNotes initialNotes={many} personId="dana" personName="Dana Whitfield" />);
    expect(screen.queryByText("Note n7")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 3 older notes" }));
    expect(screen.getByText("Note n7")).toBeTruthy();
  });

  it("shows every note rather than folding away only one or two", () => {
    render(<PersonNotes initialNotes={Array.from({ length: 7 }, (_, index) => note(`n${index}`))} personId="dana" personName="Dana Whitfield" />);
    expect(screen.getByText("Note n6")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /older notes|Show fewer/ })).toBeNull();
  });

  it("keeps the composer to one line at rest and shows its actions with focus, a draft or a failure", async () => {
    render(<PersonNotes initialNotes={[]} personId="dana" personName="Dana Whitfield" />);
    const composer = screen.getByLabelText("Add a note about Dana Whitfield") as HTMLTextAreaElement;
    expect(composer.getAttribute("rows")).toBe("1");
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();

    act(() => composer.focus());
    expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();
    act(() => composer.blur());
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();

    fireEvent.change(composer, { target: { value: "Draft survives blur" } });
    expect(screen.getByRole("button", { name: "Add note" })).toBeTruthy();
  });

  it("keeps the composer focusable and read only while saving, then returns focus to it", async () => {
    let settle: (response: Response) => void = () => {};
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { settle = resolve; }))
      .mockResolvedValueOnce(Response.json({ note: note("ok", { body: "Second try" }) }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<PersonNotes initialNotes={[]} personId="dana" personName="Dana Whitfield" />);
    const composer = screen.getByLabelText("Add a note about Dana Whitfield") as HTMLTextAreaElement;
    act(() => composer.focus());
    fireEvent.change(composer, { target: { value: "First try" } });
    fireEvent.keyDown(composer, { key: "Enter", metaKey: true });

    await waitFor(() => expect(composer.readOnly).toBe(true));
    expect(composer.disabled).toBe(false);
    expect(composer.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(composer);
    await act(async () => settle(Response.json({ error: "Could not save the note." }, { status: 503 })));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(composer.readOnly).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(composer));

    // Retrying from the alert removes its button; focus comes back to the composer.
    const retry = screen.getByRole("button", { name: "Try again" });
    act(() => retry.focus());
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Second try")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(composer));
    expect(composer.value).toBe("");
  });

  it("returns focus after a button submit but leaves it where the person moved during the save", async () => {
    let settle: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { settle = resolve; })));
    render(<><PersonNotes initialNotes={[]} personId="dana" personName="Dana Whitfield" /><button type="button">Elsewhere</button></>);
    const composer = screen.getByLabelText("Add a note about Dana Whitfield") as HTMLTextAreaElement;
    act(() => composer.focus());
    fireEvent.change(composer, { target: { value: "Button submit" } });
    const submit = screen.getByRole("button", { name: "Add note" });
    act(() => submit.focus());
    fireEvent.click(submit);
    await waitFor(() => expect(composer.readOnly).toBe(true));
    await act(async () => settle(Response.json({ note: note("a", { body: "Button submit" }) }, { status: 201 })));
    await waitFor(() => expect(screen.getByText("Button submit")).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(composer));

    fireEvent.change(composer, { target: { value: "Moved away" } });
    fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(composer.readOnly).toBe(true));
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    act(() => elsewhere.focus());
    await act(async () => settle(Response.json({ note: note("b", { body: "Moved away" }) }, { status: 201 })));
    await waitFor(() => expect(screen.getByText("Moved away")).toBeTruthy());
    await new Promise(resolve => window.requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).toBe(elsewhere);
  });

  it("keeps the date and Edited beside a long author name, with the year for older notes", () => {
    const lastYear = new Date().getFullYear() - 1;
    render(<PersonNotes initialNotes={[note("old", {
      authorName: "Alexandria Montgomery-Featherstonehaugh of the Western Logistics Office",
      createdAt: `${lastYear}-03-14T12:00:00.000Z`, updatedAt: `${lastYear}-03-20T12:00:00.000Z`,
    })]} personId="dana" personName="Dana Whitfield" />);
    const author = screen.getByText(/Alexandria Montgomery/);
    expect(author.className).toContain("truncate");
    const meta = author.nextElementSibling as HTMLElement;
    expect(meta.className).toContain("shrink-0");
    expect(within(meta).getByText(`Mar 14, ${lastYear}`).tagName).toBe("TIME");
    expect(within(meta).getByText("Edited")).toBeTruthy();
  });

  it("opens the fold of a permalinked long note hidden behind the older notes control", async () => {
    const long = Array.from({ length: 10 }, (_, line) => `Line ${line + 1}`).join("\n");
    const many = Array.from({ length: 9 }, (_, index) => note(`n${index}`, index === 8 ? { body: long } : {}));
    window.location.hash = `#note-${encodeURIComponent("n8")}`;
    render(<PersonNotes initialNotes={many} personId="dana" personName="Dana Whitfield" />);
    const item = await waitFor(() => document.getElementById("note-n8")!);
    await waitFor(() => expect(within(item).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true"));
    expect(item.querySelector("p.line-clamp-6")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(item));
    expect(screen.queryByText(/linked note is no longer here/)).toBeNull();
  });

  it("says quietly when a note link points nowhere or cannot be read, and can be dismissed", async () => {
    window.location.hash = "#note-deleted-note";
    render(<PersonNotes initialNotes={[note("n1")]} personId="dana" personName="Dana Whitfield" />);
    await waitFor(() => expect(screen.getByText("The linked note is no longer here. It may have been deleted.")).toBeTruthy());
    expect(screen.getByText("Note n1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/linked note is no longer here/)).toBeNull();
    expect(window.location.hash).toBe("");

    cleanup();
    window.location.hash = "#note-%E0%A4%A";
    render(<PersonNotes initialNotes={[note("n1")]} personId="dana" personName="Dana Whitfield" />);
    await waitFor(() => expect(screen.getByText("That note link is incomplete.")).toBeTruthy());

    act(() => {
      window.location.hash = "#note-n1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.queryByText(/note link is incomplete/)).toBeNull());
  });

  it("encodes note ids in permalinks", () => {
    expect(notePermalink("dana lee", "a/b")).toBe("/people/dana%20lee#note-a%2Fb");
  });
});
