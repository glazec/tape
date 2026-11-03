import { afterEach, describe, expect, it, vi } from "vitest";

import { readGithubActivity } from "@/lib/github-activity";

function respond(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("readGithubActivity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hides a star count below the display threshold", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/releases/latest")
          ? respond({
              tag_name: "mac-v0.3.6",
              published_at: "2026-10-30T18:20:22Z",
            })
          : respond({ stargazers_count: 1, pushed_at: "2026-11-02T19:10:44Z" }),
      ),
    );

    await expect(readGithubActivity()).resolves.toEqual({
      stars: null,
      latestRelease: { tag: "mac-v0.3.6", publishedAt: "2026-10-30T18:20:22Z" },
      pushedAt: "2026-11-02T19:10:44Z",
    });
  });

  it("shows stars once the repository passes the threshold", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/releases/latest")
          ? respond({}, false)
          : respond({
              stargazers_count: 240,
              pushed_at: "2026-11-02T19:10:44Z",
            }),
      ),
    );

    const activity = await readGithubActivity();
    expect(activity?.stars).toBe(240);
    expect(activity?.latestRelease).toBeNull();
  });

  it("returns null when GitHub is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    await expect(readGithubActivity()).resolves.toBeNull();
  });
});
