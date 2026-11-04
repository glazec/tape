import { afterEach, describe, expect, it, vi } from "vitest";
import { parseContentUrl, resolveIntelContent, xPostId } from "@/lib/intel/content";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Intel pasted content", () => {
  it("keeps pasted text off scraping services", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await resolveIntelContent("An inference team is looking for partners.")).toEqual({ text: "An inference team is looking for partners." });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["file:///etc/passwd", "http://example.com", "https://127.0.0.1", "https://[::ffff:127.0.0.1]", "https://user:pass@example.com", "https://foo.local", "https://example.com:1234"])("rejects unsafe URL %s", input => expect(() => parseContentUrl(input)).toThrow());
  it("recognizes only exact X hosts and specific post IDs", () => {
    expect(xPostId(new URL("https://x.com/a/status/123"))).toBe("123");
    expect(xPostId(new URL("https://x.com.evil.com/a/status/123"))).toBeNull();
  });
  it("falls back from blocked Exa content to the exact requested X post", async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa"); vi.stubEnv("TWITTERAPI_IO_API_KEY", "test-twitter");
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ results: [{ url: "https://x.com/a/status/123", text: "Sign in to X" }] }))
      .mockResolvedValueOnce(Response.json({ tweets: [{ id: "other", text: "Wrong post" }, { id: "123", text: "We need inference partners.", author: { userName: "a" } }] }));
    vi.stubGlobal("fetch", fetch);
    expect((await resolveIntelContent("https://x.com/a/status/123")).text).toContain("We need inference partners.");
    expect(fetch.mock.calls[1][0]).toBe("https://api.twitterapi.io/twitter/tweets?tweet_ids=123");
  });
  it("never invents content for a missing or private post", async () => {
    vi.stubEnv("EXA_API_KEY", ""); vi.stubEnv("TWITTERAPI_IO_API_KEY", "test-twitter");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tweets: [] })));
    await expect(resolveIntelContent("https://x.com/a/status/123")).rejects.toThrow("Paste the content");
  });
});
it("rejects a different page on the requested host", async () => {
  vi.stubEnv("EXA_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [{ url: "https://example.com/", text: "This is a homepage rather than the article the user requested. ".repeat(3) }] })));
  await expect(resolveIntelContent("https://example.com/article")).rejects.toThrow("Could not read");
});
it("rejects a long article instead of hiding a later qualification", async () => {
  vi.stubEnv("EXA_API_KEY", "test");
  const fetch = vi.fn().mockResolvedValue(Response.json({ results: [{ url: "https://example.com/article", text: "a".repeat(20000) + "This is no longer true." }] }));
  vi.stubGlobal("fetch", fetch);
  await expect(resolveIntelContent("https://example.com/article")).rejects.toThrow("too long to read in full");
  expect(JSON.parse(fetch.mock.calls[0][1].body).text.maxCharacters).toBe(20001);
});
it("rejects long X posts instead of trimming them", async () => {
  vi.stubEnv("EXA_API_KEY", ""); vi.stubEnv("TWITTERAPI_IO_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ tweets: [{ id: "123", text: "a".repeat(20001) }] })));
  await expect(resolveIntelContent("https://x.com/a/status/123")).rejects.toThrow("too long to read in full");
});
it("cancels oversized provider streams before buffering the whole response", async () => {
  vi.stubEnv("EXA_API_KEY", "test");
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(2100000)); }, cancel }))));
  await expect(resolveIntelContent("https://example.com/article")).rejects.toThrow("Could not read");
  expect(cancel).toHaveBeenCalledOnce();
});
