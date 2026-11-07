// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
it("retains a linked person while customizing their name and reopening", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], speaker: "Alex Q", speakerRevision: 3 }] })
    : Response.json({ people: [{ id: "person-a", name: "Alex", emails: ["alex@example.test"], inMeeting: true }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={segments} />);
  expect(screen.getAllByRole("button", { name: "Rename Alex everywhere" })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Rename Alex everywhere" })[0]);
  expect(screen.getByText(/Linked to/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Alex Q" } });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ meetingSpeakerId: "group-a", expectedRevision: 2, linkAction: "preserve", preferredName: "Alex Q" });
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex Q everywhere" }));
  expect(screen.getByText(/Linked to/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
});

it.each(["email first", "name first"])("supports %s selection without losing the edited name", async order => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "chosen", speaker: "Alex Q" }] })
    : Response.json({ people: [{ id: "chosen", name: "Alex Q", emails: ["chosen@example.test"], inMeeting: true }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  if (order === "name first") fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Alex Q" } });
  else fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "chosen@example.test" } });
  const option = await screen.findByRole("option", { name: /Alex Q.*chosen@example.test/ });
  fireEvent.pointerDown(option, { pointerType: "mouse" }); fireEvent.click(option);
  if (order === "email first") fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Alex Q" } });
  expect(screen.getByText(/Linked to Alex Q/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ linkAction: "link", personId: "chosen", speaker: "Alex Q", preferredName: "Alex Q" });
});

it("changes one line to an email free person without renaming them, then unlinks explicitly", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "maya", meetingSpeakerId: "split", speaker: "Maya", participantEmail: null }] })
    : Response.json({ people: [{ id: "maya", name: "Maya", emails: [], inMeeting: false }], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={segments} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Edit speaker Alex" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "This line" }));
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Maya" } });
  const option = await screen.findByRole("option", { name: "Maya" });
  fireEvent.pointerDown(option, { pointerType: "mouse" }); fireEvent.click(option);
  expect(screen.getByRole("checkbox", { name: "Use edited name across this workspace" })).toHaveProperty("checked", false);
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  let call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  const body = JSON.parse(String(call?.[1]?.body));
  expect(body).toMatchObject({ applyTo: "segment", personId: "maya", linkAction: "link" });
  expect(body.preferredName).toBeUndefined();
  expect(screen.getByRole("button", { name: "Edit speaker Alex" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rename Maya everywhere" }));
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  expect(screen.queryByText(/Linked to/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2));
  call = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")[1];
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ linkAction: "unlink", speaker: "Maya" });
});

it("creates an email free contact only when explicitly requested", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "new", speaker: "Sam" }] })
    : Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Create contact without email" }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  const body = JSON.parse(String(call?.[1]?.body));
  expect(body).toMatchObject({ linkAction: "create", speaker: "Sam" });
  expect(body.participantEmail).toBeUndefined();
});

it("refreshes persisted labels while preserving an active name draft", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [segments[0]] })
    : Response.json({ people: [], participants: [{ name: "Alex", email: "new@example.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.change(await screen.findByLabelText("Associate meeting email"), { target: { value: "new@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ linkAction: "link", personId: "person-a", participantEmail: "new@example.test" });
});

it("searches and selects an API participant whose name is null", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "new", speaker: "guest@example.test" }] })
    : Response.json({ people: [], participants: [{ name: null, email: "guest@example.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await screen.findByRole("option", { name: /guest@example.test/ });
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "guest@example.test" } });
  const option = screen.getByRole("option", { name: /guest@example.test/ });
  fireEvent.pointerDown(option, { pointerType: "mouse" }); fireEvent.click(option);
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "guest@example.test");
  expect(screen.getByText(/Linked to guest@example.test/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ linkAction: "create", participantEmail: "guest@example.test", speaker: "guest@example.test" });
});

it("preserves the persisted linked person when the directory request fails", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], speaker: "Alex Q" }] })
    : new Response(null, { status: 503 })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/Linked to Alex/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Alex Q" } });
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ linkAction: "preserve", preferredName: "Alex Q" });
});

it("clears a participant email when switching to a different existing person", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: "bob", speaker: "Bob" }] })
    : Response.json({ people: [{ id: "bob", name: "Bob", emails: ["bob@example.test"], inMeeting: false }], participants: [{ name: "Alice", email: "alice@example.test" }] })));
  render(<TranscriptViewer meetingId="meeting" segments={[{ ...segments[0], personId: null, participantEmail: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  const alice = await screen.findByRole("option", { name: /Alice.*alice@example.test/ });
  fireEvent.pointerDown(alice, { pointerType: "mouse" }); fireEvent.click(alice);
  fireEvent.click(screen.getByRole("button", { name: "Change person" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Bob" } });
  const bob = screen.getByRole("option", { name: /Bob.*bob@example.test/ });
  fireEvent.pointerDown(bob, { pointerType: "mouse" }); fireEvent.click(bob);
  expect(screen.getByLabelText("Associate meeting email")).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  const body = JSON.parse(String(call?.[1]?.body));
  expect(body).toMatchObject({ linkAction: "link", personId: "bob" });
  expect(body.participantEmail).toBeUndefined();
});

it("requires workspace name consent or unlink before saving an edited linked name", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "PATCH"
    ? Response.json({ updated: true, segments: [{ ...segments[0], personId: null, speaker: "Local Alex" }] })
    : Response.json({ people: [], participants: [] })));
  render(<TranscriptViewer meetingId="meeting" segments={[segments[0]]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Alex everywhere" }));
  fireEvent.change(screen.getByLabelText("Speaker name"), { target: { value: "Local Alex" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Use edited name across this workspace" }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "To change this linked name, enable Use edited name across this workspace or choose Unlink.");
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  expect(screen.getByLabelText("Speaker name")).toHaveProperty("value", "Local Alex");
  fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
  fireEvent.click(screen.getByRole("button", { name: "Save speaker" }));
  await waitFor(() => expect(screen.queryByLabelText("Speaker name")).toBeNull());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ linkAction: "unlink", speaker: "Local Alex" });
});
