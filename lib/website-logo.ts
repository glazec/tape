import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

export class WebsiteLogoError extends Error {}

export type WebsiteLogo = { bytes: Uint8Array; contentType: string; sourceUrl: string };

/** Accepts "acme.com" as well as a full URL. */
export function normalizeWebsiteUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new WebsiteLogoError("Enter a website address");

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new WebsiteLogoError("That is not a website address");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebsiteLogoError("Use an http or https address");
  }

  return url;
}

/**
 * Logo candidates from a page, best first: touch icons are square and large,
 * then declared icons by size. Social preview images are banners, so skipped.
 */
export function findLogoCandidates(html: string, pageUrl: URL) {
  const candidates: Array<{ href: string; score: number }> = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = readAttribute(tag, "rel")?.toLowerCase() ?? "";
    const href = readAttribute(tag, "href");
    if (!href || !/\bicon\b/.test(rel)) continue;

    const sizes = readAttribute(tag, "sizes") ?? "";
    const size = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/gi)].map((match) => Number(match[1])));
    const isSvg = /\.svg(\?|$)/i.test(href) || /svg/i.test(readAttribute(tag, "type") ?? "");
    const score =
      (rel.includes("apple-touch-icon") ? 1_000 : 0) + (isSvg ? 900 : 0) + Math.min(size, 800);

    try {
      candidates.push({ href: new URL(href, pageUrl).toString(), score });
    } catch {
      // A malformed href is not a candidate.
    }
  }

  return [
    ...candidates.sort((a, b) => b.score - a.score).map((candidate) => candidate.href),
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(pageUrl.hostname)}&sz=256`,
    new URL("/favicon.ico", pageUrl).toString(),
  ].filter((href, index, all) => all.indexOf(href) === index);
}

export async function fetchWebsiteLogo(input: string): Promise<WebsiteLogo> {
  const pageUrl = normalizeWebsiteUrl(input);
  let html = "";
  let resolvedPageUrl = pageUrl;

  try {
    const page = await safeFetch(pageUrl, MAX_HTML_BYTES);
    if (/html/i.test(page.contentType)) html = new TextDecoder().decode(page.bytes);
    resolvedPageUrl = page.url;
  } catch (error) {
    if (error instanceof WebsiteLogoError && error.message.startsWith("Blocked")) throw error;
    // The page may refuse bots; the icon fallbacks can still work.
  }

  for (const candidate of findLogoCandidates(html, resolvedPageUrl)) {
    try {
      const image = await safeFetch(new URL(candidate), MAX_IMAGE_BYTES);
      if (!image.contentType.startsWith("image/") || image.bytes.byteLength < 100) continue;
      return { bytes: image.bytes, contentType: image.contentType, sourceUrl: image.url.toString() };
    } catch {
      // Try the next candidate.
    }
  }

  throw new WebsiteLogoError("No logo found on that website");
}

async function safeFetch(start: URL, maxBytes: number) {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url);
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; TapeLogoFetcher/1.0)", accept: "*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      url = new URL(location, url);
      continue;
    }

    if (!response.ok || !response.body) throw new WebsiteLogoError(`Fetch failed: ${response.status}`);

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new WebsiteLogoError("Response too large");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WebsiteLogoError("Response too large");
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return { bytes, contentType: response.headers.get("content-type")?.split(";")[0].trim() ?? "", url };
  }

  throw new WebsiteLogoError("Too many redirects");
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebsiteLogoError("Blocked address");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);

  if (addresses.length === 0) throw new WebsiteLogoError("Website not found");
  if (addresses.some(isPrivateAddress)) throw new WebsiteLogoError("Blocked address");
}

export function isPrivateAddress(address: string) {
  const mapped = address.toLowerCase().replace(/^::ffff:/, "");

  if (isIP(mapped) === 4) {
    const [a, b] = mapped.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  return (
    mapped === "::" || mapped === "::1" ||
    /^f[cd]/.test(mapped) || /^fe[89ab]/.test(mapped)
  );
}

function readAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "").trim() : null;
}
