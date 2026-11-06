// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntelSearch } from "@/components/intel-search";

const timing = vi.hoisted(() => ({ start: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/sentry/search-timing", () => ({ startSearchTiming: timing.start }));
const catalog = { people: [], intel: [], pending: 0, coverage: "" };
let complete: (value: Response) => void;
let estimate: number;
beforeEach(() => {
  estimate = 0.1;
  timing.start.mockReset().mockReturnValue(timing.finish);
  timing.finish.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/intel/catalog") return Response.json({ catalog, history: [] });
    if (url === "/api/intel/search") return Response.json({ job: null });
    if (url.includes("estimate=1")) return Response.json({ id: "quote", estimate: { lowUsd: estimate, highUsd: estimate } });
    if (url.includes("quote=")) return Response.json({ id: "job" });
    return new Promise<Response>(resolve => { complete = resolve; });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function submit() {
  render(<IntelSearch />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/intel/search", expect.anything()));
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search intel or people, or paste content or a link"), { target: { value: "infrastructure" } });
  fireEvent.click(screen.getByRole("button", { name: "Find people" }));
}

it("does not finish at enqueue and finishes when completed results render", async () => {
  await submit();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/intel/search?id=job", expect.anything()));
  expect(timing.start).toHaveBeenCalledWith("intel");
  expect(timing.finish).not.toHaveBeenCalledWith("complete");
  await act(async () => complete(Response.json({ job: {
    id: "job", status: "complete", input: { kind: "content", text: "infrastructure" },
    result: { matches: [], source: { text: "infrastructure" }, coverage: "all", catalog },
  } })));
  expect(timing.finish).toHaveBeenCalledWith("complete");
});

it("excludes time waiting for price approval", async () => {
  estimate = 2;
  await submit();
  await screen.findByRole("button", { name: "Run anyway" });
  expect(timing.start).not.toHaveBeenCalled();
});
