import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "@/app/page";

const { getAuthenticatedUser, redirect } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/image", async () => {
  const { createElement } = await import("react");

  return {
    default: ({ alt, src }: { alt: string; src: unknown }) =>
      createElement("img", {
        alt,
        src:
          typeof src === "string"
            ? src
            : (src as { src?: string } | null)?.src,
      }),
  };
});

describe("landing page smoke test", () => {
  it("renders the landing page with hero, social proof, and sign-in path", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Home());

    expect(html).toContain("tape-lockup.svg");
    expect(html).toContain("Every conversation,");
    expect(html).toContain("01 · Capture");
    expect(html).toContain("02 · Every language");
    expect(html).toContain("03 · Memory");
    expect(html).toContain("04 · Agents");
    expect(html).toContain("05 · Enterprise");
    expect(html).toContain("Google Meet");
    expect(html).toContain("ElevenLabs");
    expect(html).toContain("A workspace per team");
    expect(html).toContain("Nobody wonders what they missed");
    expect(html).toContain('href="/auth/sign-in"');
    expect(html).toContain(
      'href="https://github.com/glazec/tape/releases/download/mac-v0.2.0/MeetingNoteLocalRecorder-0.2.0.zip"',
    );
    expect(html).toContain('href="https://github.com/glazec/tape"');
  });

  it("redirects signed in users to the dashboard", async () => {
    getAuthenticatedUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
    });

    await expect(Home()).rejects.toThrow("redirect:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
