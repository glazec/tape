import { afterEach, describe, expect, it, vi } from "vitest";

const { getTwentyCrmKeyterms, select } = vi.hoisted(() => ({
  getTwentyCrmKeyterms: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select },
}));

vi.mock("@/lib/vendors/twenty", () => ({
  getTwentyCrmKeyterms,
}));

describe("team vocabulary", () => {
  afterEach(() => {
    getTwentyCrmKeyterms.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("returns enabled keyterms for the transcription request", async () => {
    getTwentyCrmKeyterms.mockResolvedValue([]);
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
    expect(getTwentyCrmKeyterms).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("merges CRM names after manual team vocabulary", async () => {
    getTwentyCrmKeyterms.mockResolvedValue(["1inch", "IOSG", "Ledger"]);
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: vi.fn().mockResolvedValue([{ term: "IOSG" }]),
        }),
      }),
    });

    const { getTeamVocabularyKeyterms } = await import("@/lib/team-vocabulary");

    await expect(
      getTeamVocabularyKeyterms("22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual(["IOSG", "1inch", "Ledger"]);
  });

  it("resolves transcription keyterms through the meeting team", async () => {
    getTwentyCrmKeyterms.mockResolvedValue([]);
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
