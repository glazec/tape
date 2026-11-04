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
vi.mock("@/lib/github-activity", () => ({
  readGithubActivity: async () => null,
}));
vi.mock("next/image", async () => {
  const { createElement } = await import("react");

  return {
    default: ({ alt, src }: { alt: string; src: unknown }) =>
      createElement("img", {
        alt,
        src:
          typeof src === "string" ? src : (src as { src?: string } | null)?.src,
      }),
  };
});

describe("landing page smoke test", () => {
  it("renders the landing page with hero, social proof, and sign-in path", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Home({}));

    expect(html).toContain("tape-lockup.svg");
    expect(html).toContain("all on");
    expect(html).toContain("/media/tape-launch-v6.mp4");
    expect(html).toContain("/media/tape-launch-v6-en.vtt");
    for (const id of [
      "languages",
      "agents",
      "capture",
      "open-source",
      "followup",
      "pricing",
      "faq",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Google Meet");
    expect(html).toContain("ElevenLabs");
    expect(html).toContain("Fork it.");
    expect(html).toContain("Who owes what.");
    expect(html).toContain("Skip the bot.");
    expect(html).toContain('href="/auth/sign-in"');
    expect(html).toContain('href="/blog"');
    expect(html).toContain(
      'href="https://github.com/glazec/tape/releases/latest/download/Tape-Desktop.zip"',
    );
    expect(html).toContain('href="https://github.com/glazec/tape/fork"');
  });

  it("redirects signed in users to the dashboard", async () => {
    getAuthenticatedUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
    });

    await expect(Home({})).rejects.toThrow("redirect:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
