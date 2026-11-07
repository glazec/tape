import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, limit, execute, generate } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getWorkspace: vi.fn(), limit: vi.fn(), execute: vi.fn(), generate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: getWorkspace }));
vi.mock("@/db/client", () => ({ db: { execute, select: () => ({ from: () => ({ where: () => ({ limit }) }) }) }, privilegedDb: { execute } }));
vi.mock("@/lib/person-profile", () => ({ generatePersonProfile: generate }));
vi.mock("@/lib/people", async (original) => ({
  ...await original<typeof import("@/lib/people")>(),
  getPersonWorkspace: (user: unknown) => getWorkspace(user),
}));

import { POST as openPerson } from "@/app/api/meetings/[meetingId]/people/route";
import { PATCH as setTodo } from "@/app/api/meetings/[meetingId]/todos/route";
import { DELETE as undoMerge, GET as listCandidates, POST as merge } from "@/app/api/people/[personId]/merge/route";
import { POST as writeProfile } from "@/app/api/people/[personId]/profile/route";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) => new Request("https://example.test", { method: "POST", body: JSON.stringify(body) });
const meeting = { params: Promise.resolve({ meetingId: id }) };
const person = { params: Promise.resolve({ personId: id }) };

describe("people routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "auth", email: "a@example.test" });
    getWorkspace.mockResolvedValue({ teamId: id, userId: id });
    limit.mockResolvedValue([{ id, name: "Dana" }]);
    execute.mockResolvedValue({ rows: [{ id: other }] });
  });

  it("requires authentication everywhere", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await openPerson(post({ meetingSpeakerId: id }), meeting)).status).toBe(401);
    expect((await merge(post({ sourceIds: [other] }), person)).status).toBe(401);
    expect((await writeProfile(post({}), person)).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("opens a speaker or participant only in a meeting the viewer manages", async () => {
    expect(await (await openPerson(post({ meetingSpeakerId: id }), meeting)).json()).toEqual({ personId: other });
    expect(await (await openPerson(post({ email: "dana@acme.test", name: "Dana" }), meeting)).json()).toEqual({ personId: other });
    limit.mockResolvedValue([]);
    expect((await openPerson(post({ meetingSpeakerId: id }), meeting)).status).toBe(404);
    expect((await openPerson(post({ email: "not an email" }), meeting)).status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("maps database refusals to plain responses", async () => {
    execute.mockRejectedValueOnce({ cause: { code: "22023", message: "Name this speaker before opening a profile" } });
    const response = await openPerson(post({ meetingSpeakerId: id }), meeting);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Name this speaker before opening a profile" });
    execute.mockRejectedValueOnce({ cause: { code: "42501" } });
    expect((await merge(post({ sourceIds: [other] }), person)).status).toBe(404);
  });

  it("validates merges before touching the database", async () => {
    expect((await merge(post({ sourceIds: [] }), person)).status).toBe(400);
    expect((await merge(post({ sourceIds: ["nope"] }), person)).status).toBe(400);
    expect((await merge(post({ sourceIds: [other, other], keepName: "Dana" }), person)).status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("undoes the latest merge", async () => {
    execute.mockResolvedValue({ rows: [{ result: { personId: id, restored: [other] } }] });
    expect(await (await undoMerge(new Request("https://example.test", { method: "DELETE" }), person)).json()).toEqual({ personId: id, restored: [other] });
    execute.mockRejectedValueOnce({ cause: { code: "22023", message: "Nothing to undo" } });
    expect((await undoMerge(new Request("https://example.test", { method: "DELETE" }), person)).status).toBe(400);
  });

  it("lists merge candidates with likely duplicates first", async () => {
    execute.mockResolvedValue({ rows: [
      { id, name: "Dana Whitfield", emails: ["dana@acme.test"], names: null, meetingCount: 3 },
      { id: other, name: "Mark Lee", emails: null, names: null, meetingCount: 9 },
      { id: "33333333-3333-4333-8333-333333333333", name: "dana.w", emails: null, names: null, meetingCount: 1 },
    ] });
    const body = await (await listCandidates(new Request("https://example.test"), person)).json();
    expect(body.people.map((candidate: { name: string; likely: boolean }) => [candidate.name, candidate.likely])).toEqual([["dana.w", true], ["Mark Lee", false]]);
  });

  it("records team-wide to do progress with who and when", async () => {
    const state = { status: "in_progress", updatedBy: "Yiping", updatedAt: "2026-11-07T00:00:00.000Z" };
    execute.mockResolvedValue({ rows: [{ state }] });
    const patch = (body: unknown) => setTodo(new Request("https://example.test", { method: "PATCH", body: JSON.stringify(body) }), meeting);
    expect(await (await patch({ todoKey: "a".repeat(32), status: "in_progress" })).json()).toEqual(state);
    expect((await patch({ todoKey: "a".repeat(32), status: "archived" })).status).toBe(400);
    expect((await patch({ todoKey: "short", status: "done" })).status).toBe(400);
    execute.mockRejectedValueOnce({ cause: { code: "42501" } });
    expect((await patch({ todoKey: "a".repeat(32), status: "done" })).status).toBe(404);
  });

  it("writes a profile only for an active person in the viewer's workspace", async () => {
    generate.mockResolvedValue({ status: "no_meetings" });
    execute.mockResolvedValue({ rows: [] });
    expect(await (await writeProfile(post({}), person)).json()).toEqual({ status: "no_meetings" });
    expect(generate).toHaveBeenCalledWith({ teamId: id, userId: id }, { id, name: "Dana" });
    limit.mockResolvedValue([]);
    expect((await writeProfile(post({}), person)).status).toBe(404);
  });

  it("skips profiles for colleagues", async () => {
    execute.mockResolvedValueOnce({ rows: [{ colleague: true }] });
    expect((await writeProfile(post({}), person)).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("explains credit exhaustion and model failures without leaking details", async () => {
    execute.mockResolvedValue({ rows: [] });
    generate.mockRejectedValueOnce(new ProviderCreditExhaustedError());
    expect((await writeProfile(post({}), person)).status).toBe(402);
    generate.mockRejectedValueOnce(new Error("upstream secret detail"));
    const response = await writeProfile(post({}), person);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
