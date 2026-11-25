// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntelSearch } from "@/components/intel-search";
const catalog = { people: [], intel: [], pending: 0, coverage: "" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("announces preparation immediately while the estimate is pending", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("estimate")) return new Promise(() => {});
    return Response.json(url.includes("catalog") ? { catalog, history: [] } : { job: null });
  }));
  render(<IntelSearch />);
  await waitFor(() => expect(screen.queryByText("Loading intel and people…")).toBeNull());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Inference partners" } });
  fireEvent.click(screen.getByRole("button", { name: "Find people" }));
  expect(screen.getByRole("status").textContent).toContain("Preparing your search");
  expect(screen.getByRole("button", { name: "Preparing…" })).toHaveProperty("disabled", true);
});
it("shows a truthful queue state before a worker starts", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("catalog") ? { catalog, history: [] } : {
    job: { id: "job", input: { kind: "content", text: "Inference" }, status: "queued", completed: 0, total: 0, createdAt: new Date().toISOString() },
  })));
  render(<IntelSearch />);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Waiting for a search worker"));
  expect(screen.queryByText("Reading your meetings")).toBeNull();
});
it("ignores a late catalog response after search results supply a newer catalog", async () => {
  let resolveCatalog!: (r: Response) => void;
  const old = new Promise<Response>(resolve => { resolveCatalog = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("catalog") ? old : Response.json({
    job: { id: "job", input: { kind: "content", text: "Inference" }, status: "complete", completed: 2, total: 2,
      createdAt: new Date().toISOString(), result: { matches: [], source: { text: "Inference" }, coverage: "", catalog: { ...catalog, pending: 1 } } },
  })));
  render(<IntelSearch />);
  await screen.findByText("No people to rank");
  await act(async () => { resolveCatalog(Response.json({ catalog, history: [] })); });
  fireEvent.click(screen.getAllByRole("button", { name: "New search" })[0]);
  expect(screen.getByText(/Intel will appear as your meetings are processed/)).toBeTruthy();
});

it("shows zero relevance without presenting it as an interest probability", async () => {
 const match = {id:"p",type:"person",score:0,title:"Alex",detail:"Meeting",relevance:"related_focus",reason:"No clear connection",caveat:"",segmentIds:["s"],counterEvidenceIds:[],counterEvidence:[],evidence:[{id:"s",meetingId:"m",meetingTitle:"Meeting",date:new Date().toISOString(),speaker:"Alex",startMs:0,text:"Background"}]};
 vi.stubGlobal("fetch",vi.fn(async (url:string)=>Response.json(url.includes("catalog")?{catalog,history:[]}:{job:{id:"job",input:{kind:"content",text:"Inference"},status:"complete",completed:1,total:1,createdAt:new Date().toISOString(),result:{matches:[match],source:{text:"Inference"},coverage:""}}})));
 render(<IntelSearch/>);
 expect(await screen.findByText("Relevance 0/100")).toBeTruthy();
 expect(screen.getByText("1 person ranked")).toBeTruthy();
});

it("groups duplicate names and searches only the meeting identity chosen", async () => {
  const people = [
    { id: "person:alex1", name: "Alex Chen", detail: "Infrastructure roundtable", kind: "participant", meetingIds: ["m"], sourceDate: "2026-11-08T02:00:00Z", sourceMeetingId: "m", sourceSegmentId: "s1", sourceStartMs: 0 },
    { id: "speaker:alex2", name: "alex  chen", detail: "Infrastructure roundtable", kind: "participant", meetingIds: ["m"], sourceDate: "2026-11-08T02:00:00Z", sourceMeetingId: "m", sourceSegmentId: "s2", sourceStartMs: 74000 },
  ];
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("estimate")) return new Promise<Response>(() => {});
    return Response.json(url.includes("catalog") ? { catalog: { ...catalog, people }, history: [] } : { job: null });
  });
  vi.stubGlobal("fetch", fetch);
  render(<IntelSearch />);
  fireEvent.click(await screen.findByRole("tab", { name: "People" }));
  const rows = within(screen.getByRole("tabpanel")).getAllByRole("button", { name: /Alex Chen/i });
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain("2 speaker records");
  fireEvent.click(rows[0]);
  const dialog = within(screen.getByRole("dialog"));
  const choices = dialog.getAllByRole("checkbox");
  expect(choices).toHaveLength(2);
  expect(choices.every(choice => !(choice as HTMLInputElement).checked)).toBe(true);
  expect(dialog.getByRole("button", { name: "Find matches" })).toHaveProperty("disabled", true);
  expect(dialog.getByRole("link", { name: /1:14/ }).getAttribute("href")).toBe("/meetings/m#s2");
  fireEvent.click(choices[1]);
  fireEvent.click(dialog.getByRole("button", { name: "Find matches" }));
  expect(fetch).toHaveBeenCalledWith("/api/intel/search?estimate=1", expect.objectContaining({
    body: JSON.stringify({ kind: "person", ids: ["speaker:alex2"] }),
  }));
});

it("shows separate source timestamps for same-name results from one meeting", async () => {
  const date = "2026-11-08T02:00:00Z";
  const people = [0, 74000].map((sourceStartMs, index) => ({
    id: `person:${index}`, name: "Alex Chen", detail: "Roundtable", kind: "participant", meetingIds: ["m"],
    sourceDate: date, sourceMeetingId: "m", sourceSegmentId: `s${index}`, sourceStartMs,
  }));
  const matches = people.map(person => ({
    id: person.id, type: "person", title: person.name, detail: person.detail, relevance: "related_focus",
    reason: "Shared interest", caveat: "", segmentIds: [person.sourceSegmentId], counterEvidenceIds: [], counterEvidence: [],
    evidence: [{ id: person.sourceSegmentId, meetingId: "m", meetingTitle: person.detail, date, speaker: person.name, startMs: person.sourceStartMs, text: "Source" }],
  }));
  const resultCatalog = { ...catalog, people };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("catalog") ? { catalog: resultCatalog, history: [] } : {
    job: { id: "job", input: { kind: "content", text: "Inference" }, status: "complete", completed: 1, total: 1,
      createdAt: date, result: { matches, source: { text: "Inference" }, coverage: "", catalog: resultCatalog } },
  })));
  render(<IntelSearch />);
  await screen.findByText("2 people ranked");
  const cards = screen.getAllByRole("article");
  expect(cards[0].textContent).toContain("Roundtable · Nov 8, 2026 · 0:00");
  expect(cards[1].textContent).toContain("Roundtable · Nov 8, 2026 · 1:14");
});

function memoryStorage() {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, String(v)); }, removeItem: (k: string) => { values.delete(k); }, clear: () => values.clear() };
  vi.stubGlobal("localStorage", storage);
  return storage;
}
it("shows cached search history at once, once per input, and clears the cache with it", async () => {
  const localStorage = memoryStorage();
  const key = "tape.intel.history:team:user";
  const entry = (id: string, text: string, createdAt: string) => ({ id, savedJob: true, input: { kind: "content", text }, label: text, createdAt });
  localStorage.setItem(key, JSON.stringify([entry("b", "AI infrastructure", "2026-11-08T02:00:00Z"), entry("a", "AI infrastructure", "2026-11-08T01:00:00Z"), entry("c", "Robotics", "2026-11-07T00:00:00Z")]));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("catalog") || url === "/api/intel/history" && !init?.method) return new Promise<Response>(() => {});
    if (init?.method === "DELETE") return Response.json({ cleared: true });
    return Response.json({ job: null });
  }));
  render(<IntelSearch historyCacheKey={key} />);
  const history = screen.getByRole("complementary", { name: "Search history" });
  await waitFor(() => expect(history.textContent).toContain("Robotics"));
  expect(history.textContent?.match(/AI infrastructure/g)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Toggle search history" }).textContent).toContain("· 2");
  fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
  await waitFor(() => expect(localStorage.getItem(key)).toBe("[]"));
  expect(history.textContent).not.toContain("Robotics");
});
it("replaces cached history with the server's typed history without waiting for transcripts", async () => {
  const localStorage = memoryStorage();
  const key = "tape.intel.history:team:fresh";
  localStorage.setItem(key, JSON.stringify([{ id: "old", savedJob: true, input: { kind: "content", text: "Deleted elsewhere" }, label: "Deleted elsewhere", createdAt: "2026-11-01T00:00:00Z" }]));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("catalog")) return new Promise<Response>(() => {});
    if (url === "/api/intel/history") return Response.json({ history: [{ id: "new", savedJob: true, input: { kind: "content", text: "GPU capacity" }, label: "GPU capacity", createdAt: "2026-11-08T00:00:00Z" }] });
    return Response.json({ job: null });
  }));
  render(<IntelSearch historyCacheKey={key} />);
  const history = screen.getByRole("complementary", { name: "Search history" });
  await waitFor(() => expect(history.textContent).toContain("GPU capacity"));
  expect(history.textContent).not.toContain("Deleted elsewhere");
  expect(JSON.parse(localStorage.getItem(key)!)[0].id).toBe("new");
});
