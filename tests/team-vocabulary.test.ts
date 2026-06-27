import { afterEach, describe, expect, it, vi } from "vitest";

const { select } = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select },
}));

describe("team vocabulary", () => {
  afterEach(() => {
    select.mockReset();
    vi.resetModules();
  });

  it("returns enabled keyterms for the transcription request", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: vi.fn().mockResolvedValue([
            { term: " IOSG " },
            { term: "TCG platform" },
            { term: "iosg" },
          ]),
        }),
      }),
    });

    const { getTeamVocabularyKeyterms } = await import("@/lib/team-vocabulary");

    await expect(
      getTeamVocabularyKeyterms("22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual(["IOSG", "TCG platform"]);
  });

  it("resolves transcription keyterms through the meeting team", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              { teamId: "22222222-2222-4222-8222-222222222222" },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([{ term: "Sophon" }]),
          }),
        }),
      });

    const { getMeetingVocabularyKeyterms } = await import(
      "@/lib/team-vocabulary"
    );

    await expect(
      getMeetingVocabularyKeyterms("11111111-1111-4111-8111-111111111111"),
    ).resolves.toEqual(["Sophon"]);
  });
});
