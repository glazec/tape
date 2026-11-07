import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { INTEL_VERIFIER_MODEL, verifyIntelClaims } from "@/lib/intel/verification";

const fetchDecision = vi.fn();
const usage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/provider-usage", () => ({ recordOpenRouterCompletionUsage: usage }));
function respond(answers: unknown) {
  fetchDecision.mockResolvedValue(Response.json({ id: "gen-1", model: INTEL_VERIFIER_MODEL,
    usage: { cost: 0.000042, input_tokens: 1000, output_tokens: 30 }, answers }));
}
beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.stubGlobal("fetch", fetchDecision);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("checks all candidates in one request and records the reported charge once", async () => {
  respond({ claim_1: { type: "noul", noul: 0.89 }, claim_0: { type: "noul", noul: 0.9 } });
  const claims = ["supported", "uncertain"];
  expect(await verifyIntelClaims(claims, "shared evidence", "meeting")).toEqual(["supported"]);
  expect(fetchDecision).toHaveBeenCalledTimes(1);
  const [url, init] = fetchDecision.mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
  const body = JSON.parse(init.body);
  expect(body.model).toBe("typesafe/jev-1.14");
  expect(body.state).toEqual({ evidence: "shared evidence", candidates: { claim_0: claims[0], claim_1: claims[1] } });
  expect(Object.keys(body.questions)).toEqual(["claim_0", "claim_1"]);
  expect(usage).toHaveBeenCalledWith(expect.objectContaining({ operation: "decisions", generationId: "gen-1",
    usage: { costUsd: 0.000042, promptTokens: 1000, completionTokens: 30, totalTokens: 1030 } }));
});
it("rejects missing, unexpected or invalid answers", async () => {
  for (const answers of [{}, { other: { type: "noul", noul: 1 } }, { claim_0: { type: "noul", noul: 2 } }]) {
    respond(answers);
    await expect(verifyIntelClaims(["test"], "evidence", "meeting")).rejects.toThrow();
  }
});
it("skips empty batches and propagates provider failures", async () => {
  expect(await verifyIntelClaims([], {}, "meeting")).toEqual([]);
  expect(fetchDecision).not.toHaveBeenCalled();
  fetchDecision.mockResolvedValue(new Response("private details", { status: 429 }));
  await expect(verifyIntelClaims(["test"], {}, "meeting")).rejects.toThrow("HTTP 429");
});
it("checks a recommendation as supported relevance, without requiring the recipient to repeat new intel", async () => {
 respond({ claim_0: { type: "noul", noul: 0.91 } });
 const claim = { reason: "Frank asked about the take rate.", relevance: "expressed_interest", segmentIds: ["s1"] };
 expect(await verifyIntelClaims([claim], {}, "")).toEqual([claim]);
 const body = JSON.parse(fetchDecision.mock.calls[0][1].body);
 expect(body.questions.claim_0.instructions).toContain("as a recommendation");
 expect(body.questions.claim_0.instructions).toContain("do not require the recipient to repeat");
 expect(body.questions.claim_0.instructions).toContain("later contradictions");
});
