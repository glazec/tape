import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "../proxy";

describe("Web authentication routing", () => {
  it("preserves the requested meeting when sign in is required", async () => {
    const response = await proxy(new NextRequest("https://app.example.com/meetings/abc?tab=notes"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/auth/sign-in");
    expect(destination.searchParams.get("callbackUrl")).toBe("/meetings/abc?tab=notes");
    expect(config.matcher).toContain("/meetings/:path*");
  });
  it("routes old sessions through server verification before entering the app", async () => {
    const response = await proxy(new NextRequest("https://app.example.com/dashboard", {
      headers: { cookie: "__Secure-neon-auth.session_token=legacy" },
    }));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/api/auth/migrate-session");
  });
  it("leaves new cookie validation to protected pages and APIs", async () => {
    const response = await proxy(new NextRequest("https://app.example.com/dashboard", {
      headers: { cookie: "__Secure-tape-auth.session_token=opaque" },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("lets anonymous recorder requests reach the route recovery UI", async () => {
    const response = await proxy(new NextRequest("https://app.example.com/api/local-recorder/device-login?deviceId=mac_123"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("migrates recorder browser sessions while preserving device parameters", async () => {
    const path = "/api/local-recorder/device-login?deviceId=mac_123&callbackUrl=meetingnote-local-recorder%3A%2F%2Flogin";
    const response = await proxy(new NextRequest(`https://app.example.com${path}`, {
      headers: { cookie: "__Secure-neon-auth.session_token=legacy" },
    }));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/api/auth/migrate-session");
    expect(destination.searchParams.get("callbackUrl")).toBe(path);
  });
});
