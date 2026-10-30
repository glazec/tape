import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({ auth: { api: { signOut: vi.fn(async () =>
  new Response(null, { headers: { "set-cookie": "__Secure-tape-auth.session_token=; Max-Age=0" } })) } } }));

describe("POST /api/sign-out", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("revokes the database session and expires legacy cookies", async () => {
    const { POST } = await import("@/app/api/sign-out/route");

    const response = await POST(
      new Request("https://app.example.com/api/sign-out", {
        method: "POST",
        headers: {
          cookie:
            "__Secure-neon-auth.session_token=abc; app_theme=dark; __Secure-neon-auth.local.session_data=def",
        },
      }),
    );

    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie");

    expect(setCookie).toContain("__Secure-neon-auth.session_token=");
    expect(setCookie).toContain("__Secure-tape-auth.session_token=");
    expect(setCookie).toContain("__Secure-neon-auth.local.session_data=");
    expect(setCookie).toContain("meeting_note_impersonated_user_id=");
    expect(setCookie).not.toContain("app_theme");
  });
  it("accepts the public origin behind a reverse proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const { POST } = await import("@/app/api/sign-out/route");
    expect((await POST(new Request("http://0.0.0.0:8080/api/sign-out", {
      method: "POST", headers: { origin: "https://app.example.com" },
    }))).status).toBe(204);
  });
  it("rejects cross origin sign out", async () => {
    const { POST } = await import("@/app/api/sign-out/route");
    expect((await POST(new Request("https://app.example.com/api/sign-out", {
      method: "POST", headers: { origin: "https://evil.example" },
    }))).status).toBe(403);
  });
});
