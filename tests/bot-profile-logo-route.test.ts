import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchWebsiteLogo, getAdminTeamSettingsWorkspace } = vi.hoisted(() => ({
  fetchWebsiteLogo: vi.fn(),
  getAdminTeamSettingsWorkspace: vi.fn(),
}));

vi.mock("@/lib/team-settings-access", () => ({ getAdminTeamSettingsWorkspace }));
vi.mock("@/lib/website-logo", async () => ({
  ...(await vi.importActual<typeof import("@/lib/website-logo")>("@/lib/website-logo")),
  fetchWebsiteLogo,
}));

async function getLogo(url: string) {
  const { GET } = await import("@/app/api/team/bot-profile/logo/route");
  return GET(
    new Request(
      `https://app.example.com/api/team/bot-profile/logo?teamId=t1&url=${encodeURIComponent(url)}`,
    ),
  );
}

describe("GET /api/team/bot-profile/logo", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("only lets team admins look up logos", async () => {
    getAdminTeamSettingsWorkspace.mockResolvedValue(
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );

    expect((await getLogo("acme.com")).status).toBe(403);
    expect(fetchWebsiteLogo).not.toHaveBeenCalled();
  });

  it("returns the logo bytes with a script-free policy", async () => {
    getAdminTeamSettingsWorkspace.mockResolvedValue({ teamId: "t1", userId: "u1", domain: "acme.com" });
    fetchWebsiteLogo.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/svg+xml",
      sourceUrl: "https://acme.com/logo.svg",
    });

    const response = await getLogo("acme.com");

    expect(response.status).toBe(200);
    expect(fetchWebsiteLogo).toHaveBeenCalledWith("acme.com");
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("x-logo-source")).toBe("https://acme.com/logo.svg");
  });

  it("explains when no logo is found", async () => {
    const { WebsiteLogoError } = await import("@/lib/website-logo");
    getAdminTeamSettingsWorkspace.mockResolvedValue({ teamId: "t1", userId: "u1", domain: "acme.com" });
    fetchWebsiteLogo.mockRejectedValue(new WebsiteLogoError("No logo found on that website"));

    const response = await getLogo("acme.com");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "No logo found on that website" });
  });
});

describe("website logo helpers", () => {
  it("prefers touch icons and blocks private addresses", async () => {
    const { findLogoCandidates, isPrivateAddress, normalizeWebsiteUrl } =
      await vi.importActual<typeof import("@/lib/website-logo")>("@/lib/website-logo");
    const page = new URL("https://acme.com/");
    const candidates = findLogoCandidates(
      `<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="/touch.png">`,
      page,
    );

    expect(candidates[0]).toBe("https://acme.com/touch.png");
    expect(candidates[1]).toBe("https://acme.com/favicon-32.png");
    expect(normalizeWebsiteUrl("acme.com").toString()).toBe("https://acme.com/");
    expect(() => normalizeWebsiteUrl("ftp://acme.com")).toThrow();
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
});
