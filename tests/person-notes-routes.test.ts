import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getPersonWorkspace: vi.fn(),
  getPersonIdentity: vi.fn(),
  listPersonNotes: vi.fn(),
  createPersonNote: vi.fn(),
  updatePersonNote: vi.fn(),
  deletePersonNote: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/people", () => mocks);
vi.mock("@/lib/person-notes", async original => ({ ...await original<typeof import("@/lib/person-notes")>(), ...mocks }));
vi.mock("@/db/client", () => ({ db: {} }));

import { GET, POST } from "@/app/api/people/[personId]/notes/route";
import { DELETE, PATCH } from "@/app/api/people/[personId]/notes/[noteId]/route";

const personId = "11111111-1111-4111-8111-111111111111";
const noteId = "22222222-2222-4222-8222-222222222222";
const person = { params: Promise.resolve({ personId }) };
const noteContext = { params: Promise.resolve({ personId, noteId }) };
const workspace = { teamId: "team", userId: "user", domain: "example.test" };
const note = {
  id: noteId, body: "Interested in mobile AI.", authorName: "A colleague",
  createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z", canEdit: true,
};
const request = (method: string, body?: unknown) => new Request("https://example.test", {
  method, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "user", email: "test@example.test" });
  mocks.getPersonWorkspace.mockResolvedValue(workspace);
  mocks.getPersonIdentity.mockResolvedValue({ kind: "found" });
});

it("lists shared notes and accepts a valid new note with whitespace trimmed", async () => {
  mocks.listPersonNotes.mockResolvedValue([note]);
  mocks.createPersonNote.mockResolvedValue(note);
  expect(await (await GET(request("GET"), person)).json()).toEqual({ notes: [note] });
  const response = await POST(request("POST", { body: `  ${note.body}  ` }), person);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ note });
  expect(mocks.createPersonNote).toHaveBeenCalledWith(workspace, personId, note.body);
});

it("requires authenticated Person page access for all operations", async () => {
  mocks.getCurrentUser.mockResolvedValueOnce(null);
  expect((await GET(request("GET"), person)).status).toBe(401);
  mocks.getPersonIdentity.mockResolvedValue({ kind: "missing" });
  expect((await POST(request("POST", { body: note.body }), person)).status).toBe(404);
  expect((await PATCH(request("PATCH", { body: note.body }), noteContext)).status).toBe(404);
  expect((await DELETE(request("DELETE"), noteContext)).status).toBe(404);
  expect(mocks.listPersonNotes).not.toHaveBeenCalled();
  expect(mocks.createPersonNote).not.toHaveBeenCalled();
  expect(mocks.updatePersonNote).not.toHaveBeenCalled();
  expect(mocks.deletePersonNote).not.toHaveBeenCalled();
});

it("returns 400 for an empty or oversized note before looking up the page", async () => {
  expect((await POST(request("POST", { body: " " }), person)).status).toBe(400);
  expect((await PATCH(request("PATCH", { body: "x".repeat(4001) }), noteContext)).status).toBe(400);
  expect(mocks.getPersonIdentity).not.toHaveBeenCalled();
});

it("returns the updated note or 204 for a deletion and hides an uneditable note", async () => {
  mocks.updatePersonNote.mockResolvedValueOnce(note).mockResolvedValueOnce(null);
  mocks.deletePersonNote.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await (await PATCH(request("PATCH", { body: note.body }), noteContext)).json()).toEqual({ note });
  expect((await PATCH(request("PATCH", { body: note.body }), noteContext)).status).toBe(404);
  expect((await DELETE(request("DELETE"), noteContext)).status).toBe(204);
  expect((await DELETE(request("DELETE"), noteContext)).status).toBe(404);
  expect(mocks.updatePersonNote).toHaveBeenCalledWith(workspace, personId, noteId, note.body);
  expect(mocks.deletePersonNote).toHaveBeenCalledWith(workspace, personId, noteId);
});
