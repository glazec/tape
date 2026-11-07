// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
