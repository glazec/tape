// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntelSearch } from "@/components/intel-search";

const note = { noteId: "n1", personId: "p1", authorName: "Priya Shah" };
// Notes use the person page's local date: the year appears only outside the current year.
const lastYear = new Date().getFullYear() - 1;
const noteDate = `${lastYear}-11-03T10:00:00Z`;
const people = [
  { id: "person:p1", name: "Alex Kim", detail: "Person note", kind: "participant", meetingIds: ["person-note:n1"], noteCount: 1, sourcePersonNote: note,
    sourceDate: noteDate, sourceMeetingId: "person-note:n1", sourceSegmentId: "person-note:n1" },
  { id: "person:p2", name: "Jo Lee", detail: "Weekly sync", kind: "participant", meetingIds: ["m1", "m2", "person-note:n2"], noteCount: 1,
    sourceDate: "2026-10-01T10:00:00Z", sourceMeetingId: "m1", sourceSegmentId: "s1" },
  { id: "person:p3", name: "Sam Wu", detail: "Weekly sync", kind: "participant", meetingIds: ["m1"], sourceDate: "2026-10-01T10:00:00Z", sourceMeetingId: "m1", sourceSegmentId: "s9" },
];
const catalog = { people, intel: [], pending: 0, coverage: "" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function serve(job: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("catalog") ? { catalog, history: [] } : url.includes("history") ? { history: [] } : { job })));
}

it("presents person note evidence as a dated, attributed note and keeps transcript evidence unchanged", async () => {
  const match = { id: "person:p1", type: "person", score: 70, title: "Alex Kim", detail: "Person note", relevance: "expressed_interest", reason: "A note records interest.", caveat: "",
    segmentIds: ["person-note:n1", "s1"], counterEvidenceIds: [], counterEvidence: [], evidence: [
      { id: "person-note:n1", meetingId: "person-note:n1", meetingTitle: "Person note", date: noteDate, speaker: "Alex Kim", startMs: 0, text: "Looking for GPU capacity.", personNote: note },
      { id: "s1", meetingId: "m1", meetingTitle: "Weekly sync", date: "2026-10-01T10:00:00Z", speaker: "Alex Kim", startMs: 12_000, text: "We need inference partners." },
    ] };
  serve({ id: "job", input: { kind: "content", text: "GPUs" }, status: "complete", completed: 1, total: 1, createdAt: new Date().toISOString(), result: { matches: [match], source: { text: "GPUs" }, coverage: "" } });
  const { container } = render(<IntelSearch />);
  await screen.findByText("1 person ranked");
  const links = [...container.querySelectorAll("details a")] as HTMLAnchorElement[];
  const noteLink = links.find(a => a.textContent?.includes("Person note by"))!;
  expect(noteLink.getAttribute("href")).toBe("/people/p1#note-n1");
  expect(noteLink.textContent).toBe(`Person note by Priya Shah · Nov 3, ${lastYear} `);
  expect(noteLink.querySelector("time")!.getAttribute("datetime")).toBe(noteDate);
  const noteFigure = noteLink.closest("figure")!;
  expect(noteFigure.textContent).not.toContain("Alex Kim");
  expect(noteFigure.textContent).not.toContain("0:00");
  expect(noteFigure.textContent).not.toContain("“");
  const transcriptLink = links.find(a => a.getAttribute("href") === "/meetings/m1#s1")!;
  expect(transcriptLink.textContent).toContain("Alex Kim · Weekly sync · Oct 1, 2026 · 0:12");
  expect(transcriptLink.closest("blockquote")!.textContent).toContain("“We need inference partners.”");
});

it("counts notes separately from meetings and links note-only people to the note", async () => {
  serve(null);
  render(<IntelSearch />);
  fireEvent.click(await screen.findByRole("tab", { name: "People" }));
  const panel = screen.getByRole("tabpanel");
  const row = (name: string) => within(panel).getByText(name).closest("button")!;
  expect(row("Alex Kim").textContent).toContain("1 note");
  expect(row("Alex Kim").textContent).not.toContain("meeting");
  expect(row("Jo Lee").textContent).toContain("2 meetings · 1 note");
  expect(row("Sam Wu").textContent).toContain("1 meeting");
  expect(row("Sam Wu").textContent).not.toContain("note");

  fireEvent.click(row("Alex Kim"));
  const dialog = await screen.findByRole("dialog");
  const open = within(dialog).getByRole("link", { name: "Open person note" });
  expect(open.getAttribute("href")).toBe("/people/p1#note-n1");
  expect(dialog.textContent).toContain(`Person note by Priya Shah · Nov 3, ${lastYear} · 1 note`);
  expect(within(dialog).queryByRole("link", { name: "Open source passage" })).toBeNull();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.click(row("Jo Lee"));
  const mixed = await screen.findByRole("dialog");
  expect(within(mixed).getByRole("link", { name: "Open source passage" }).getAttribute("href")).toBe("/meetings/m1#s1");
  expect(mixed.textContent).toContain("Oct 1, 2026 · 2 meetings · 1 note");
});
