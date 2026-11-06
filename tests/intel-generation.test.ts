import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadIntelMeetings: vi.fn(), getMeetingOwnerWorkspace: vi.fn(), assertWorkspaceHasProviderCredit: vi.fn(), createOpenRouterChatCompletion: vi.fn(), verifyIntelClaims: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { update: mocks.update } }));
vi.mock("@/lib/intel/store", () => mocks);
vi.mock("@/lib/intel/verification", () => mocks);
vi.mock("@/lib/meeting-followup-generation", () => mocks);
vi.mock("@/lib/provider-credit", () => mocks);
vi.mock("@/lib/vendors/openrouter", () => mocks);
import { generateMeetingIntel } from "@/lib/intel/generation";
import { intelSourceHash } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
const m: IntelMeeting = { id: "m1", title: "m1", date: new Date().toISOString(), startedAt: null, status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null, segments: [{ id: "s1", speaker: "Alex", text: "We need inference partners", startMs: 0 }] };
beforeEach(() => {
 vi.clearAllMocks(); mocks.getMeetingOwnerWorkspace.mockResolvedValue({ userId: "u", teamId: "t" });
 mocks.loadIntelMeetings.mockResolvedValue([m]); mocks.update.mockReturnValue(mocks); mocks.set.mockReturnValue(mocks); mocks.where.mockReturnValue(mocks); mocks.returning.mockResolvedValue([{ id: "m1" }]);
 mocks.createOpenRouterChatCompletion.mockResolvedValue('{"items":[]}'); mocks.verifyIntelClaims.mockResolvedValue([]);
});
describe("background intel generation", () => {
 it("records an attempt before provider failures, so backfill can advance", async () => {
  mocks.createOpenRouterChatCompletion.mockRejectedValue(new Error("Provider failed"));
  await expect(generateMeetingIntel("m1")).rejects.toThrow("Provider failed");
  expect(mocks.set.mock.calls[0][0].aiIntel.checkedAt).toBeTruthy(); expect(mocks.set).toHaveBeenCalledTimes(1);
 });
 it("advances checked time for already current extraction without model usage", async () => {
  mocks.loadIntelMeetings.mockResolvedValue([{ ...m, aiIntel: { sourceHash: intelSourceHash(m), result: { items: [] } } }]);
  expect(await generateMeetingIntel("m1")).toEqual({ status: "already_current" });
  expect(mocks.set.mock.calls[0][0].aiIntel.checkedAt).toBeTruthy(); expect(mocks.createOpenRouterChatCompletion).not.toHaveBeenCalled();
 });
 it("does not save generation when transcript changes during the model call", async () => {
  mocks.loadIntelMeetings.mockResolvedValueOnce([m]).mockResolvedValueOnce([{ ...m, segments: [{ ...m.segments[0], text: "Replaced transcript" }] }]);
  expect(await generateMeetingIntel("m1")).toEqual({ status: "transcript_changed" }); expect(mocks.set).toHaveBeenCalledTimes(1);
 });
 it("saves only independently verified extraction", async () => {
  expect(await generateMeetingIntel("m1")).toEqual({ status: "saved" });
  expect(mocks.verifyIntelClaims).toHaveBeenCalled(); expect(mocks.set.mock.calls[1][0].aiIntel.result).toEqual({ items: [] });
 });
 it("records truncated output as a terminal failure without throwing for retries", async () => {
  mocks.createOpenRouterChatCompletion.mockRejectedValue(new Error("OpenRouter model z-ai/glm-5.3-flash failed after 1 attempts: OpenRouter completion stopped at the token limit"));
  expect(await generateMeetingIntel("m1")).toEqual({ status: "failed" });
  const failure = mocks.set.mock.calls[1][0].aiIntel;
  expect(failure).toMatchObject({ failedSourceHash: intelSourceHash(m), failures: 1 }); expect(failure.failedAt).toBeTruthy();
 });
 it("records malformed JSON as a terminal failure", async () => {
  mocks.createOpenRouterChatCompletion.mockResolvedValue('{"items":[');
  expect(await generateMeetingIntel("m1")).toEqual({ status: "failed" });
 });
 it("increments failures for the same transcript", async () => {
  mocks.loadIntelMeetings.mockResolvedValue([{ ...m, aiIntel: { checkedAt: "x", failedSourceHash: intelSourceHash(m), failures: 1 } }]);
  mocks.createOpenRouterChatCompletion.mockResolvedValue("not json");
  expect(await generateMeetingIntel("m1")).toEqual({ status: "failed" });
  expect(mocks.set.mock.calls[1][0].aiIntel.failures).toBe(2);
 });
 it("stops calling the model after repeated failures on an unchanged transcript", async () => {
  mocks.loadIntelMeetings.mockResolvedValue([{ ...m, aiIntel: { checkedAt: "x", failedSourceHash: intelSourceHash(m), failures: 2 } }]);
  expect(await generateMeetingIntel("m1")).toEqual({ status: "gave_up" });
  expect(mocks.createOpenRouterChatCompletion).not.toHaveBeenCalled();
 });
 it("retries a previously failed meeting after its transcript changes", async () => {
  mocks.loadIntelMeetings.mockResolvedValue([{ ...m, aiIntel: { checkedAt: "x", failedSourceHash: "old-hash", failures: 2 } }]);
  expect(await generateMeetingIntel("m1")).toEqual({ status: "saved" });
  expect(mocks.createOpenRouterChatCompletion).toHaveBeenCalledTimes(1);
 });
 it("uses one GLM max reasoning attempt with strict structured output", async () => {
  await generateMeetingIntel("m1");
  const call = mocks.createOpenRouterChatCompletion.mock.calls[0][0];
  expect(call).toMatchObject({ model: "z-ai/glm-5.3-flash", reasoningEffort: "max", attempts: 1, provider: { require_parameters: true } });
  expect(call.responseFormat).toMatchObject({ type: "json_schema", json_schema: { name: "intel_extraction", strict: true } });
 });
 it("rethrows verifier failures so Inngest retries them", async () => {
  mocks.verifyIntelClaims.mockRejectedValue(new Error("Claim verification was incomplete"));
  await expect(generateMeetingIntel("m1")).rejects.toThrow("Claim verification was incomplete");
  expect(mocks.set).toHaveBeenCalledTimes(1);
 });
});
