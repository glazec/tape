import { afterEach, describe, expect, it, vi } from "vitest";

const { isTwentyCrmTeam } = vi.hoisted(() => ({
  isTwentyCrmTeam: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/twenty-crm-access", () => ({
  isTwentyCrmTeam,
}));

const IOSG_TEAM_ID = "11111111-1111-4111-8111-111111111111";

describe("Twenty CRM vendor", () => {
  afterEach(() => {
    isTwentyCrmTeam.mockReset();
    isTwentyCrmTeam.mockResolvedValue(true);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads recent company and people names from GraphQL as keyterms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          companies: {
            edges: [
              { node: { name: " 1inch " } },
              { node: { name: "Ledger" } },
            ],
          },
          people: {
            edges: [
              { node: { name: { firstName: "Bowei", lastName: "Guang" } } },
              { node: { name: { firstName: "Ledger", lastName: "" } } },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getTwentyCrmKeyterms } = await import("@/lib/vendors/twenty");

    await expect(
      getTwentyCrmKeyterms(IOSG_TEAM_ID, {
        TWENTY_API_BASE_URL: "https://crm.example.com/rest",
        TWENTY_API_KEY: "twenty-key",
      }),
    ).resolves.toEqual(["1inch", "Ledger", "Bowei Guang"]);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe("https://crm.example.com/graphql");
    expect(init.headers.Authorization).toBe("Bearer twenty-key");
  });

  it("does not contact Twenty for a non IOSG team", async () => {
    isTwentyCrmTeam.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getTwentyCrmCompanyDomains, getTwentyCrmKeyterms } = await import(
      "@/lib/vendors/twenty"
    );
    const source = {
      TWENTY_API_BASE_URL: "https://crm.example.com/rest",
      TWENTY_API_KEY: "twenty-key",
    };

    await expect(
      getTwentyCrmKeyterms("22222222-2222-4222-8222-222222222222", source),
    ).resolves.toEqual([]);
    await expect(
      getTwentyCrmCompanyDomains(
        "22222222-2222-4222-8222-222222222222",
        source,
      ),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps keyterms empty when CRM keyterm fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { getTwentyCrmKeyterms } = await import("@/lib/vendors/twenty");

    await expect(
      getTwentyCrmKeyterms(IOSG_TEAM_ID, {
        TWENTY_API_BASE_URL: "https://crm.example.com/rest",
        TWENTY_API_KEY: "twenty-key",
      }),
    ).resolves.toEqual([]);
  });

  it("loads recent company domains from GraphQL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          companies: {
            edges: [
              {
                node: {
                  name: "Babylon Labs",
                  domainName: {
                    primaryLinkLabel: "Babylon",
                    primaryLinkUrl: "https://www.babylonlabs.io/",
                  },
                },
              },
              {
                node: {
                  name: "NewCo",
                  domainName: {
                    primaryLinkLabel: "newco.example",
                    primaryLinkUrl: null,
                  },
                },
              },
              {
                node: {
                  name: "Missing Domain",
                  domainName: null,
                },
              },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getTwentyCrmCompanyDomains } = await import("@/lib/vendors/twenty");

    await expect(
      getTwentyCrmCompanyDomains(IOSG_TEAM_ID, {
        TWENTY_API_BASE_URL: "https://crm.example.com/rest",
        TWENTY_API_KEY: "twenty-key",
      }),
    ).resolves.toEqual([
      {
        domain: "babylonlabs.io",
        name: "Babylon Labs",
      },
      {
        domain: "newco.example",
        name: "NewCo",
      },
    ]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain(
      "domainName",
    );
  });

  it("returns no keyterms when credentials are missing or CRM errors", async () => {
    const { getTwentyCrmCompanyDomains, getTwentyCrmKeyterms } = await import(
      "@/lib/vendors/twenty"
    );

    await expect(getTwentyCrmKeyterms(IOSG_TEAM_ID, {})).resolves.toEqual([]);
    await expect(
      getTwentyCrmCompanyDomains(IOSG_TEAM_ID, {}),
    ).resolves.toEqual([]);
  });
});
