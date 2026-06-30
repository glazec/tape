import { afterEach, describe, expect, it, vi } from "vitest";

describe("Twenty CRM vendor", () => {
  afterEach(() => {
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
      getTwentyCrmKeyterms({
        TWENTY_API_BASE_URL: "https://crm.example.com/rest",
        TWENTY_API_KEY: "twenty-key",
      }),
    ).resolves.toEqual(["1inch", "Ledger", "Bowei Guang"]);

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe("https://crm.example.com/graphql");
    expect(init.headers.Authorization).toBe("Bearer twenty-key");
  });

  it("keeps keyterms empty when CRM keyterm fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { getTwentyCrmKeyterms } = await import("@/lib/vendors/twenty");

    await expect(
      getTwentyCrmKeyterms({
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
      getTwentyCrmCompanyDomains({
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

    await expect(getTwentyCrmKeyterms({})).resolves.toEqual([]);
    await expect(getTwentyCrmCompanyDomains({})).resolves.toEqual([]);
  });
});
