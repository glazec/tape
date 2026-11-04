import { z } from "zod";

export class IntelInputError extends Error {}
export function parseContentUrl(text: string) {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { throw new IntelInputError("Enter a valid public URL or paste its text."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new IntelInputError("Use a public HTTPS link, or paste the content.");
  }
  url.hash = "";
  return url;
}
export function xPostId(url: URL) {
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(url.hostname)) return null;
  return url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)\/?$/)?.[1] ?? null;
}
async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Content provider unavailable");
  const text = await response.text();
  if (text.length > 2000000) throw new Error("Content response too large");
  return JSON.parse(text) as unknown;
}
export async function resolveIntelContent(text: string): Promise<{ text: string; url?: string }> {
  const url = parseContentUrl(text);
  if (!url) return { text };
  const tweetId = xPostId(url);
  if (["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(url.hostname) && !tweetId) {
    throw new IntelInputError("Paste a specific X post link, or paste its text.");
  }
  if (process.env.EXA_API_KEY) {
    try {
      const value = await jsonRequest("https://api.exa.ai/contents", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": process.env.EXA_API_KEY },
        body: JSON.stringify({ urls: [url.href], text: { maxCharacters: 20000 }, livecrawl: "preferred" }) });
      const result = z.object({ results: z.array(z.object({ url: z.string().url(), text: z.string() })) }).parse(value).results
        .find(r => tweetId ? xPostId(new URL(r.url)) === tweetId : new URL(r.url).href.replace(/\/$/, "") === url.href.replace(/\/$/, ""));
      if (result && result.text.trim().length >= 80 && !/sign in to x|javascript is not available|something went wrong|access denied|just a moment/i.test(result.text.slice(0, 500))) {
        return { text: result.text.slice(0, 20000), url: url.href };
      }
    } catch { /* A failed extraction can use the X fallback below. */ }
  }
  if (tweetId && process.env.TWITTERAPI_IO_API_KEY) {
    try {
      const value = await jsonRequest(`https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`, { headers: { "X-API-Key": process.env.TWITTERAPI_IO_API_KEY } });
      const tweet = z.object({ tweets: z.array(z.object({ id: z.string(), text: z.string(), author: z.object({ userName: z.string() }).optional(), createdAt: z.string().optional() })) }).parse(value).tweets.find(t => t.id === tweetId);
      if (tweet?.text.trim()) return { text: `${tweet.author?.userName ?? "Author unavailable"}\n${tweet.createdAt ?? ""}\n${tweet.text}`.slice(0, 20000), url: url.href };
    } catch { /* Never match against a URL when its content could not be read. */ }
  }
  throw new IntelInputError("Could not read this link. Paste the content to find interested people.");
}
