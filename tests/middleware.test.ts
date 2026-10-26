import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const neonProxyHandler = vi.fn(() => NextResponse.next());
const middleware = vi.fn(() => neonProxyHandler);

vi.mock("@/lib/auth/server", () => ({
  auth: {
    middleware,
  },
}));

describe("Neon Auth middleware", () => {
  it("runs on authenticated app routes so OAuth can exchange verifier tokens", async () => {
    const proxyModule = await import("../proxy");
    const request = new NextRequest("https://app.example.com/dashboard");

    expect(middleware).toHaveBeenCalledWith({ loginUrl: "/auth/sign-in" });
    expect(await proxyModule.proxy(request)).toBeInstanceOf(Response);
    expect(neonProxyHandler).toHaveBeenCalledWith(request);
    expect(proxyModule.config.matcher).toEqual([
      "/dashboard/:path*",
      "/settings/:path*",
      "/meetings/:path*",
      "/api/local-recorder/device-login",
    ]);
  });

  it("returns a shared meeting recipient to the original link after sign in", async () => {
    neonProxyHandler.mockReturnValueOnce(NextResponse.redirect("https://app.example.com/auth/sign-in"));
    const { proxy } = await import("../proxy");
    const response = await proxy(new NextRequest("https://app.example.com/meetings/abc?tab=notes"));
    const destination = new URL(response.headers.get("location")!, "https://app.example.com");
    expect(destination.searchParams.get("callbackUrl")).toBe("/meetings/abc?tab=notes");
  });

  it("keeps relative sign in redirects relative behind a reverse proxy", async () => {
    const redirect = NextResponse.next();
    redirect.headers.set("location", "/auth/sign-in");
    neonProxyHandler.mockReturnValueOnce(redirect);
    const { proxy } = await import("../proxy");
    const response = await proxy(new NextRequest("https://0.0.0.0:8080/meetings/abc"));
    expect(response.headers.get("location")).toBe("/auth/sign-in?callbackUrl=%2Fmeetings%2Fabc");
  });

  it("lets plain local recorder device login requests reach the route handler", async () => {
    const proxyModule = await import("../proxy");
    const request = new NextRequest(
      "https://app.example.com/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin",
    );

    neonProxyHandler.mockClear();

    const response = await proxyModule.proxy(request);

    expect(response).not.toBe("next-response");
    expect(neonProxyHandler).not.toHaveBeenCalled();
  });

  it("runs Neon Auth middleware for local recorder OAuth verifier callbacks", async () => {
    const proxyModule = await import("../proxy");
    const request = new NextRequest(
      "https://app.example.com/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin&neon_auth_session_verifier=verifier_123",
    );

    neonProxyHandler.mockClear();

    expect(await proxyModule.proxy(request)).toBeInstanceOf(Response);
    expect(neonProxyHandler).toHaveBeenCalledWith(request);
  });
});
