import { startInactiveSpan } from "@sentry/nextjs";

export type SearchOutcome = "complete" | "failed" | "cancelled";
export function startSearchTiming(flow: "meeting_library" | "intel") {
  const span = startInactiveSpan({
    name: `search.${flow}`,
    op: "search",
    parentSpan: null,
    attributes: { "search.flow": flow },
  });
  let ended = false;
  return (outcome: SearchOutcome) => {
    if (ended) return;
    ended = true;
    span.setAttribute("search.outcome", outcome);
    span.setStatus(outcome === "complete" ? { code: 1 } : { code: 2, message: outcome === "cancelled" ? "cancelled" : "internal_error" });
    span.end();
  };
}
export function sampleSearchTraces(
  context: { name: string; inheritOrSampleWith: (rate: number) => number },
  development: boolean,
) {
  if (context.name === "search.meeting_library" || context.name === "search.intel") return 1;
  return context.inheritOrSampleWith(development ? 1 : 0.1);
}
