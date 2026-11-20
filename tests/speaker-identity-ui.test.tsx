// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { TranscriptViewer, applySpeakerUpdateToSegments, getSpeakerPreviewClips, type TranscriptSegment } from "@/components/transcript-viewer";
const segments: TranscriptSegment[] = [
  { id: "a", meetingSpeakerId: "group-a", personId: "person-a", speakerRevision: 2, speaker: "Alex", sourceSpeaker: "Speaker 1", participantEmail: "alex@example.test", text: "First voice", startMs: 0, endMs: 1000 },
  { id: "b", meetingSpeakerId: "group-b", personId: "person-b", speaker: "Alex", text: "Second voice", startMs: 1000, endMs: 2000 },
];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("targets immutable groups without merging equal names or voice previews", () => {
  const updated = applySpeakerUpdateToSegments(segments, { currentSpeaker: "Alex", speakerKey: "group-a", meetingSpeakerId: "group-a", segmentId: "a", speakerAliases: ["Alex"], allowSegmentScope: true }, "matching_speaker", "Sam");
  expect(updated.map(s => s.speaker)).toEqual(["Sam", "Alex"]);
  expect(getSpeakerPreviewClips(segments, "Alex", [], "group-a")).toEqual([{ startMs: 0, endMs: 1000 }]);
});

const resizeObserver = class { observe() {} unobserve() {} disconnect() {} };
function pick(option: HTMLElement) { fireEvent.pointerDown(option, { pointerType: "mouse" }); fireEvent.click(option); }
function patchBodies() { return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body))); }

it("renames a linked person only through the explicit rename option, then reopens linked", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], speaker: "Alex Q", speakerRevision: 3 }] })
    : Response.json({ people: [{ id: "person-a", name: "Alex", emails: ["alex@example.test"], inMeeting: true }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={segments} />);
  expect(screen.getAllByRole("button", { name: "Rename Alex everywhere" })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Rename Alex everywhere" })[0]);
  expect(screen.getByRole("group", { name: "Linked to Alex" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Alex Q" } });
  pick(screen.getByRole("option", { name: /Rename Alex to “Alex Q”/ }));
  expect(screen.getByText("Renamed in all meetings")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  expect(patchBodies()[0]).toMatchObject({ meetingSpeakerId: "group-a", expectedRevision: 2, linkAction: "preserve", preferredName: "Alex Q" });
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex Q everywhere" }));
  expect(screen.getByRole("group", { name: "Linked to Alex Q" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
});

it("offers create, rename and label choices when a linked speaker is retyped as someone new", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "dz", speaker: "Dong Zhen" }] })
    : Response.json({ people: [{ id: "person-a", name: "Alex", emails: ["alex@example.test"], inMeeting: true }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Dong Zhen" } });
  expect(screen.getByRole("option", { name: /Create “Dong Zhen”/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /Rename Alex to “Dong Zhen”/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /Use as label only/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  expect(await screen.findByText("Who is “Dong Zhen”?")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(patchBodies()).toHaveLength(0);
  pick(screen.getByRole("option", { name: /Create “Dong Zhen”/ }));
  expect(screen.getByRole("group", { name: "New person Dong Zhen" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "create", speaker: "Dong Zhen" });
  expect(body.preferredName).toBeUndefined();
  expect(body.personId).toBeUndefined();
});

it("restores the linked name with Keep instead of choosing", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  const input = screen.getByLabelText("Speaker name");
  fireEvent.change(input, { target: { value: "Someone" } });
  fireEvent.blur(input);
  expect(screen.getByText("Still Alex?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep Alex" }));
  expect(input).toHaveProperty("value", "Alex");
  expect(screen.getByRole("group", { name: "Linked to Alex" })).toBeTruthy();
  fireEvent.change(input, { target: { value: "Someone else" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveProperty("value", "Alex");
});

it.each(["email first", "name first"])("supports %s search and links the chosen person", async order => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "chosen", speaker: "Alex Q" }] })
    : Response.json({ people: [{ id: "chosen", name: "Alex Q", emails: ["chosen@example.test"], inMeeting: true }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: order === "name first" ? "alex q" : "chosen@example.test" } });
  pick(await screen.findByRole("option", { name: /Alex Q.*chosen@example.test/ }));
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "Alex Q");
  expect(screen.getByRole("group", { name: "Linked to Alex Q" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "link", personId: "chosen", speaker: "Alex Q" });
  expect(body.preferredName).toBeUndefined();
});

it("changes one line to an email free person without renaming them, then unlinks explicitly", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "maya", meetingSpeakerId: "split", speaker: "Maya", participantEmail: null }] })
    : Response.json({ people: [{ id: "maya", name: "Maya", emails: [], inMeeting: false }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={segments} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Edit speaker Alex" })[0]);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "This line" }));
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Maya" } });
  expect(screen.queryByRole("option", { name: /Rename Alex/ })).toBeNull();
  pick(await screen.findByRole("option", { name: "Maya" }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const body = patchBodies()[0];
  expect(body).toMatchObject({ applyTo: "segment", personId: "maya", linkAction: "link" });
  expect(body.preferredName).toBeUndefined();
  expect(screen.getByRole("button", { name: "Edit speaker Alex" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rename Maya everywhere" }));
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(screen.queryByRole("group", { name: /Linked to/ })).toBeNull();
  expect(screen.getByText("Unlinked from Maya")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(2));
  expect(patchBodies()[1]).toMatchObject({ linkAction: "unlink", speaker: "Maya" });
});

it("creates an email free person only when explicitly requested", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "new", speaker: "Sam" }] })
    : Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Sam" } });
  pick(screen.getByRole("option", { name: /Create “Sam”/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "create", speaker: "Sam" });
  expect(body.participantEmail).toBeUndefined();
});

it("saves an unlinked name as a label only by default", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: null, speaker: "Sam" }] })
    : Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.blur(screen.getByLabelText("Speaker name"));
  expect(screen.getByText("No person linked")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  expect(patchBodies()[0]).toMatchObject({ linkAction: "preserve", speaker: "Sam" });
});

it("refreshes persisted labels while preserving an active name draft", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], participants: [] })));
  const view = render(<TranscriptViewer meetingId="meeting" segments={segments} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Rename Alex everywhere" })[0]);
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "My draft" } });
  view.rerender(<TranscriptViewer meetingId="meeting" segments={segments.map(segment => segment.id === "b" ? { ...segment, speaker: "Updated elsewhere" } : segment)} />);
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "My draft");
  expect(screen.getByRole("button", { name: "Rename Updated elsewhere everywhere" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel speaker edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename Updated elsewhere everywhere" }));
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "Updated elsewhere");
});

it("explicitly associates a selected meeting email with an existing person", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [segments[0]] })
    : Response.json({ people: [], participants: [{ name: "Alex", email: "new@example.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add an email from this meeting" }));
  fireEvent.change(screen.getByLabelText("Associate meeting email"), { target: { value: "new@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  expect(patchBodies()[0]).toMatchObject({ linkAction: "link", personId: "person-a", participantEmail: "new@example.test" });
});

it("searches and selects an API participant whose name is null", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "new", speaker: "guest@example.test" }] })
    : Response.json({ people: [], participants: [{ name: null, email: "guest@example.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await screen.findByRole("option", { name: /guest@example.test/ });
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "guest@example.test" } });
  pick(screen.getByRole("option", { name: /^guest@example.test$/ }));
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("placeholder", "Add a name");
  expect(screen.getByRole("group", { name: "New person guest@example.test" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  expect(patchBodies()[0]).toMatchObject({ linkAction: "create", participantEmail: "guest@example.test", speaker: "guest@example.test" });
});

it("preserves the persisted linked person when the directory request fails", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], speaker: "Alex" }] })
    : new Response(null, { status: 503 })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("group", { name: "Linked to Alex" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  expect(patchBodies()[0]).toMatchObject({ linkAction: "preserve", speaker: "Alex" });
});

it("clears a participant email when switching to a different existing person", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "bob", speaker: "Bob" }] })
    : Response.json({ people: [{ id: "bob", name: "Bob", emails: ["bob@example.test"], inMeeting: false }], participants: [{ name: "Alice", email: "alice@example.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  pick(await screen.findByRole("option", { name: /Alice.*alice@example.test/ }));
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Bob" } });
  pick(screen.getByRole("option", { name: /Bob.*bob@example.test/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add an email from this meeting" }));
  expect(screen.getByLabelText("Associate meeting email")).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "link", personId: "bob" });
  expect(body.participantEmail).toBeUndefined();
});

it("unlinks to save a different name as a label without touching the person", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: null, speaker: "Local Alex" }] })
    : Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Local Alex" } });
  pick(screen.getByRole("option", { name: /Use as label only/ }));
  expect(screen.getByText("Unlinked from Alex")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "unlink", speaker: "Local Alex" });
  expect(body.preferredName).toBeUndefined();
});

it("names the linked person from their record and offers rename only for that person", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [
    { id: "person-a", name: "Alex Rivera", emails: ["alex@example.test"], inMeeting: true },
    { id: "momir", name: "Momir", emails: ["momir@example.test"], inMeeting: true },
  ], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  expect(await screen.findByRole("group", { name: "Linked to Alex Rivera" })).toBeTruthy();
  const input = screen.getByLabelText("Speaker name");
  fireEvent.change(input, { target: { value: "Mo" } });
  expect(screen.getByRole("option", { name: /Rename Alex Rivera to “Mo”/ })).toBeTruthy();
  pick(screen.getByRole("option", { name: /Momir/ }));
  fireEvent.change(input, { target: { value: "Momir B" } });
  expect(screen.queryByRole("option", { name: /Rename/ })).toBeNull();
});

it("disarms a chosen rename when the name is typed again", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  const input = screen.getByLabelText("Speaker name");
  fireEvent.change(input, { target: { value: "Bob" } });
  pick(screen.getByRole("option", { name: /Rename Alex to “Bob”/ }));
  fireEvent.change(input, { target: { value: "Carol Jones" } });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  expect(await screen.findByText("Who is “Carol Jones”?")).toBeTruthy();
  expect(patchBodies()).toHaveLength(0);
});

it("treats a capitalization fix of a linked name as a rename choice", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], speaker: "ALEX" }] })
    : Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "ALEX" } });
  pick(screen.getByRole("option", { name: /Rename Alex to “ALEX”/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toMatchObject({ linkAction: "preserve", preferredName: "ALEX" });
});

it("names a person created from a participant by their real name, not the search text", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "new", speaker: "Alice Wang" }] })
    : Response.json({ people: [], participants: [{ name: null, email: "alice@x.test" }, { name: "Alice Wang", email: "alice@x.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await screen.findByRole("option", { name: /Alice Wang/ });
  const input = screen.getByLabelText("Speaker name");
  fireEvent.change(input, { target: { value: "ali" } });
  expect(screen.getAllByRole("option", { name: /alice@x.test/ })).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveProperty("value", "Alice Wang");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toMatchObject({ linkAction: "create", speaker: "Alice Wang", participantEmail: "alice@x.test" });
});

it("links the existing person when a fallback participant turns out to be one", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  let resolveDirectory!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((_url, init) => init?.method === "PATCH"
    ? Promise.resolve(Response.json({ updated: true, segments: [{ ...segments[0], personId: "alice" }] }))
    : new Promise<Response>(resolve => { resolveDirectory = resolve; })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} speakerSuggestions={[{ name: "Alice", email: "alice@x.test" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  pick(screen.getByRole("option", { name: /Alice/ }));
  await act(async () => resolveDirectory(Response.json({ people: [{ id: "alice", name: "Alice", emails: ["alice@x.test"], inMeeting: true }], participants: [{ name: "Alice", email: "alice@x.test" }] })));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "link", personId: "alice" });
  expect(body.participantEmail).toBeUndefined();
});

it("keeps the keyboard highlight when the directory finishes loading", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  let resolveDirectory!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((_url, init) => init?.method === "PATCH"
    ? Promise.resolve(Response.json({ updated: true, segments: [segments[0]] }))
    : new Promise<Response>(resolve => { resolveDirectory = resolve; })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} speakerSuggestions={[{ name: "Zed", email: "zed@x.test" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  const input = screen.getByLabelText("Speaker name");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const highlighted = input.getAttribute("aria-activedescendant");
  expect(highlighted).toBeTruthy();
  await act(async () => resolveDirectory(Response.json({ people: [{ id: "amy", name: "Amy", emails: [], inMeeting: true }], participants: [{ name: "Zed", email: "zed@x.test" }] })));
  expect(input.getAttribute("aria-activedescendant")).toBe(highlighted);
});

const skimDirectory = { people: [{ id: "person-a", name: "Alex", emails: ["alex@example.test"], inMeeting: true }], participants: [{ name: "Taylor Reed", email: "taylor@example.test" }, { name: null, email: "guest@partner.test" }, { name: null, email: "skim@sk.com" }] };
const unlinkedSpeaker = { ...segments[0], personId: null, participantEmail: null, speaker: "Speaker 2" };

it("creates a typed name with an unclaimed bare meeting email that resembles it", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...unlinkedSpeaker, personId: "simon", speaker: "Simon" }] })
    : Response.json(skimDirectory)));
  render(<TranscriptViewer meetingId="meeting" segments={[unlinkedSpeaker]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit speaker Speaker 2" }));
  await screen.findByRole("option", { name: /skim@sk.com/ });
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Simon" } });
  const creates = screen.getAllByRole("option", { name: /^Create “Simon”/ });
  // guest@partner.test does not resemble "Simon", so only skim@sk.com is offered.
  expect(creates.map(option => option.textContent)).toEqual(["Create “Simon”skim@sk.com", "Create “Simon”No email"]);
  pick(creates[0]!);
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "Simon");
  expect(screen.getByRole("group", { name: "New person Simon" }).textContent).toContain("skim@sk.com");
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toMatchObject({ linkAction: "create", speaker: "Simon", participantEmail: "skim@sk.com" });
});

it("asks for a name after choosing a bare email, without searching again", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...unlinkedSpeaker, personId: "simon", speaker: "Simon" }] })
    : Response.json(skimDirectory)));
  render(<TranscriptViewer meetingId="meeting" segments={[unlinkedSpeaker]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit speaker Speaker 2" }));
  await screen.findByRole("option", { name: /skim@sk.com/ });
  const input = screen.getByLabelText("Speaker name");
  fireEvent.change(input, { target: { value: "skim" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveProperty("value", "");
  expect(input).toHaveProperty("placeholder", "Add a name");
  fireEvent.change(input, { target: { value: "Simon" } });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("group", { name: "New person Simon" })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toMatchObject({ linkAction: "create", speaker: "Simon", participantEmail: "skim@sk.com" });
});

it("clears a diarization placeholder when a bare email is picked from the full list", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(skimDirectory)));
  render(<TranscriptViewer meetingId="meeting" segments={[unlinkedSpeaker]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit speaker Speaker 2" }));
  pick(await screen.findByRole("option", { name: /skim@sk.com/ }));
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  expect(screen.getByRole("listbox")).toBeTruthy();
});

function renderUnlinked(directory: unknown = skimDirectory) {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...unlinkedSpeaker, personId: "simon", speaker: "Simon" }] })
    : Response.json(directory)));
  render(<TranscriptViewer meetingId="meeting" segments={[unlinkedSpeaker]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit speaker Speaker 2" }));
  return screen.getByLabelText("Speaker name");
}

async function nameSkimAsSimon(input: HTMLElement) {
  await screen.findByRole("option", { name: /skim@sk.com/ });
  fireEvent.change(input, { target: { value: "Simon" } });
  pick(screen.getAllByRole("option", { name: /^Create “Simon”\s*skim@sk.com/ })[0]!);
}

it("hides create with email rows when the typed text already matches a participant", async () => {
  const input = renderUnlinked();
  await screen.findByRole("option", { name: /skim@sk.com/ });
  fireEvent.change(input, { target: { value: "skim" } });
  expect(screen.getAllByRole("option", { name: /^Create “skim”/ }).map(option => option.textContent)).toEqual(["Create “skim”"]);
  expect(screen.queryByRole("option", { name: /taylor@example.test/ })).toBeNull();
});

it("keeps naming when arrows are pressed and steps back to search with Escape", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveProperty("value", "Simon");
  expect(screen.getByRole("option", { name: /^Create “Simon”\s*skim@sk.com/ })).toBeTruthy();
  expect(screen.queryByRole("group", { name: /New person/ })).toBeNull();
  expect(screen.getByLabelText("Speaker name")).toBeTruthy();
});

it("undoes a chosen email back to the typed name without unlinking anyone", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(input).toHaveProperty("value", "Simon");
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "preserve", speaker: "Simon" });
  expect(body.participantEmail).toBeUndefined();
});

it("restores the name when Change closes without a choice", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  expect(screen.getByRole("option", { name: /Momir|Alex/ })).toBeTruthy();
  fireEvent.change(input, { target: { value: "Tay" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveProperty("value", "Simon");
  expect(screen.getByRole("group", { name: "New person Simon" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toMatchObject({ linkAction: "create", speaker: "Simon", participantEmail: "skim@sk.com" });
});

it("does not give a linked person's name to a new person from a bare email", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(skimDirectory)));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await screen.findByRole("group", { name: "Linked to Alex" });
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  pick(screen.getByRole("option", { name: /skim@sk.com/ }));
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("placeholder", "Add a name");
});

it("adopts the record name when a picked fallback email turns out to be a person", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  let resolveDirectory!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((_url, init) => init?.method === "PATCH"
    ? Promise.resolve(Response.json({ updated: true, segments: [{ ...unlinkedSpeaker, personId: "simon", speaker: "Simon" }] }))
    : new Promise<Response>(resolve => { resolveDirectory = resolve; })));
  render(<TranscriptViewer meetingId="meeting" segments={[unlinkedSpeaker]} speakerSuggestions={[{ name: "skim@sk.com", email: "skim@sk.com" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit speaker Speaker 2" }));
  pick(screen.getByRole("option", { name: /skim@sk.com/ }));
  await act(async () => resolveDirectory(Response.json({ people: [{ id: "simon", name: "Simon", emails: ["skim@sk.com"], inMeeting: true }], participants: [] })));
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "Simon");
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  const body = patchBodies()[0];
  expect(body).toMatchObject({ linkAction: "link", personId: "simon", speaker: "Simon" });
  expect(body.participantEmail).toBeUndefined();
});

it("asks instead of reverting when Save is clicked after typing into a Change search", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "Dong Zhen" } });
  fireEvent.blur(input);
  expect(input).toHaveProperty("value", "Dong Zhen");
  expect(screen.getByText("Still Simon, skim@sk.com?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  expect(await screen.findByText("Who is “Dong Zhen”?")).toBeTruthy();
  expect(patchBodies()).toHaveLength(0);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveProperty("value", "Simon");
  expect(screen.getByRole("group", { name: "New person Simon" })).toBeTruthy();
});

it("restores an untouched name when the field loses focus after Change", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.blur(input);
  expect(input).toHaveProperty("value", "Simon");
  expect(screen.getByRole("group", { name: "New person Simon" })).toBeTruthy();
});

it("does not copy a chosen person's name onto a new person from a bare email", async () => {
  const input = renderUnlinked();
  pick(await screen.findByRole("option", { name: /Taylor Reed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  pick(screen.getByRole("option", { name: /skim@sk.com/ }));
  expect(input).toHaveProperty("value", "");
});

it("carries a name typed for one address over to another address", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "guest" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveProperty("value", "Simon");
  expect(screen.getByRole("group", { name: "New person Simon" }).textContent).toContain("guest@partner.test");
});

it("restores the kept name with Escape after a pending Change search", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "Dong Zhen" } });
  fireEvent.blur(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveProperty("value", "Simon");
  expect(screen.getByRole("group", { name: "New person Simon" }).textContent).toContain("skim@sk.com");
  fireEvent.change(input, { target: { value: "Sam" } });
  expect(input).toHaveProperty("value", "Sam");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("keeps searching from a pending Change and offers the chosen address with the new name", async () => {
  const input = renderUnlinked();
  await nameSkimAsSimon(input);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "Dong" } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "Dong Zhen" } });
  pick(screen.getByRole("option", { name: /^Create “Dong Zhen”\s*skim@sk.com/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(patchBodies()).toHaveLength(1));
  expect(patchBodies()[0]).toMatchObject({ linkAction: "create", speaker: "Dong Zhen", participantEmail: "skim@sk.com" });
});

it("asks before saving a Change search typed over a new person without email", async () => {
  const input = renderUnlinked();
  await screen.findByRole("option", { name: /skim@sk.com/ });
  fireEvent.change(input, { target: { value: "Simon" } });
  pick(screen.getByRole("option", { name: /^Create “Simon”\s*No email/ }));
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "Tay" } });
  fireEvent.blur(input);
  expect(screen.getByText("Still Simon, new person?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  expect(await screen.findByText("Who is “Tay”?")).toBeTruthy();
  expect(patchBodies()).toHaveLength(0);
});

it("still offers a bare address when a named participant merely contains the typed name", async () => {
  renderUnlinked({ people: [], participants: [{ name: "Simone Li", email: "simone@x.test" }, { name: null, email: "skim@sk.com" }] });
  await screen.findByRole("option", { name: /skim@sk.com/ });
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Simon" } });
  expect(screen.getByRole("option", { name: /Simone Li/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /^Create “Simon”\s*skim@sk.com/ })).toBeTruthy();
});

it("never pins a named participant's address to a different name", async () => {
  const input = renderUnlinked();
  pick(await screen.findByRole("option", { name: /Taylor Reed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "Dong Zhen" } });
  expect(screen.queryByRole("option", { name: /taylor@example.test/ })).toBeNull();
});

it("restores a linked name with Escape after a Change search was left open", async () => {
  vi.stubGlobal("ResizeObserver", resizeObserver);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  const input = screen.getByLabelText("Speaker name");
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(input, { target: { value: "Dong Zhen" } });
  fireEvent.blur(input);
  expect(screen.getByText("Still Alex?")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveProperty("value", "Alex");
  expect(screen.getByLabelText("Speaker name")).toBeTruthy();
});
