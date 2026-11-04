import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createOpenRouterChatCompletion: vi.fn() }));
vi.mock("@/lib/vendors/openrouter", () => mocks);
import { verifyIntelClaims } from "@/lib/intel/verification";
afterEach(() => vi.clearAllMocks());
describe("independent claim verification", () => {
  it("drops contradicted interest and invented numbers when the critic rejects them", async () => {
    const claims = [{ text: "Alex committed $50 million to GPUs" }, { reason: "Alex is interested in GPUs", relevance: "expressed_interest" }];
    mocks.createOpenRouterChatCompletion.mockResolvedValue(JSON.stringify({ decisions: [{ index: 0, supported: false }, { index: 1, supported: false }] }));
    expect(await verifyIntelClaims(claims, [{ speaker: "Alex", text: "I am not interested in GPUs. My colleague Ben researches GPUs." }], "m1")).toEqual([]);
    const call = mocks.createOpenRouterChatCompletion.mock.calls[0][0];
    expect(call.messages[0].content).toContain("negation"); expect(call.messages[1].content).toContain("My colleague Ben");
  });
  it("fails closed when a decision is missing, duplicated, or out of range", async () => {
    for (const decisions of [[], [{ index: 1, supported: true }], [{ index: 0, supported: true }, { index: 0, supported: true }]]) {
      mocks.createOpenRouterChatCompletion.mockResolvedValue(JSON.stringify({ decisions }));
      await expect(verifyIntelClaims(["claim"], "source", "m")).rejects.toThrow("incomplete");
    }
  });
  it("propagates verifier errors rather than displaying unchecked output", async () => {
    mocks.createOpenRouterChatCompletion.mockRejectedValue(new Error("Unavailable"));
    await expect(verifyIntelClaims(["claim"], "source", "m")).rejects.toThrow("Unavailable");
  });
});
