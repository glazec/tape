import { afterEach, describe, expect, it, vi } from "vitest";

async function getFavicon(domain: string) {
  const { GET } = await import("@/app/api/favicons/route");

  return GET(new Request(`https://app.example.com/api/favicons?domain=${domain}`));
}

describe("GET /api/favicons", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns 404 when DuckDuckGo returns a placeholder miss", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("placeholder", {
        headers: {
          "content-type": "image/png",
        },
        status: 404,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getFavicon("ethereum.com");

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://icons.duckduckgo.com/ip3/ethereum.com.ico",
      { redirect: "follow" },
    );
  });

  it("proxies successful favicon bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("icon-bytes", {
        headers: {
          "content-type": "image/x-icon",
        },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getFavicon("ethereum.org");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/x-icon");
    expect(response.headers.get("cache-control")).toContain("s-maxage=2592000");
    await expect(response.text()).resolves.toBe("icon-bytes");
  });
});
