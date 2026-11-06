import { beforeEach, expect, it, vi } from "vitest";
import { startSearchTiming, sampleSearchTraces } from "@/lib/sentry/search-timing";

const span = vi.hoisted(() => ({ end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn() }));
const start = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ startInactiveSpan: start }));
beforeEach(() => { vi.clearAllMocks(); start.mockReturnValue(span); });

it("keeps a search open until completion and ends it only once", () => {
  const finish = startSearchTiming("intel");
  expect(span.end).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledWith(expect.objectContaining({
    name: "search.intel", op: "search", parentSpan: null,
    attributes: { "search.flow": "intel" },
  }));
  finish("complete");
  finish("cancelled");
  expect(span.end).toHaveBeenCalledTimes(1);
  expect(span.setAttribute).toHaveBeenCalledWith("search.outcome", "complete");
});

it("distinguishes abandoned searches from successful results", () => {
  startSearchTiming("meeting_library")("cancelled");
  expect(span.setAttribute).toHaveBeenCalledWith("search.outcome", "cancelled");
  expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: "cancelled" });
});

it("captures every search but preserves sampling for other browser traces", () => {
  const inheritOrSampleWith = vi.fn(() => 0.1);
  for (const name of ["search.intel", "search.meeting_library"]) {
    expect(sampleSearchTraces({ name, inheritOrSampleWith }, false)).toBe(1);
  }
  expect(inheritOrSampleWith).not.toHaveBeenCalled();
  expect(sampleSearchTraces({ name: "GET /dashboard", inheritOrSampleWith }, false)).toBe(0.1);
  expect(inheritOrSampleWith).toHaveBeenCalledWith(0.1);
});
