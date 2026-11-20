import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/people/[personId]/transcripts/route";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), getCurrentUser: vi.fn(), getPersonIdentity: vi.fn(), exportTranscriptSection: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/people", () => ({
  getPersonIdentity: mocks.getPersonIdentity, getPersonWorkspace: async () => ({ teamId: "team", userId: "user" }),
}));
vi.mock("@/lib/transcript-export", () => ({
  exportTranscriptSection: mocks.exportTranscriptSection, sanitizeFilename: () => "Simon",
}));

const personId = "11111111-1111-4111-8111-111111111111";
const get = () => GET(new Request("https://example.test"), { params: Promise.resolve({ personId }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "user" });
  mocks.getPersonIdentity.mockResolvedValue({ kind: "found", data: { person: { id: personId, name: "Simon" } } });
});

it("requires a session and directory access before enumerating meetings", async () => {
  mocks.getCurrentUser.mockResolvedValueOnce(null);
  expect((await get()).status).toBe(401);
  mocks.getPersonIdentity.mockResolvedValueOnce({ kind: "missing" });
  expect((await get()).status).toBe(404);
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("downloads every returned meeting in order, including those beyond the page limit", async () => {
  const meetings = Array.from({ length: 205 }, (_, i) => ({ id: String(i), title: "Meeting " + i, at: "2026-11-01" }));
  mocks.execute.mockResolvedValue({ rows: meetings });
  mocks.exportTranscriptSection.mockImplementation(async (_workspace, id, title) => title + "\nTranscript " + id);
  const response = await get();
  expect(response.headers.get("content-disposition")).toContain('filename="Simon transcripts.txt"');
  expect(await response.text()).toBe(meetings.map(m => "2026-11-01 · " + m.title + "\nTranscript " + m.id + "\n").join(""));
});

it("explains an empty export and encodes punctuation in international filenames", async () => {
  mocks.getPersonIdentity.mockResolvedValue({ kind: "found", data: { person: { id: personId, name: "李 (Simon)" } } });
  mocks.execute.mockResolvedValue({ rows: [] });
  const response = await get();
  expect(response.headers.get("content-disposition")).toContain("%E6%9D%8E%20%28Simon%29");
  expect(await response.text()).toContain("No transcripts available");
  expect(mocks.exportTranscriptSection).not.toHaveBeenCalled();
});
