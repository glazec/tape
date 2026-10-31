import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

// Node's address parser also checks IPv4 embedded in IPv6, including hex forms.
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["127.0.0.0", 8],
  ["100.64.0.0", 10], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.168.0.0", 16], ["224.0.0.0", 3],
] as const) privateAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) privateAddresses.addSubnet(address, prefix, "ipv6");

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
    const addresses = await resolvePublicHost(url);
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      request(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; TapeLogoFetcher/1.0)", accept: "*/*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // Connect only to the addresses checked above, without a second DNS lookup.
        // Keeping the original URL preserves the Host header and TLS server name.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      }, resolve).once("error", reject).end();
    });

    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.destroy();
      if (!location) break;
      url = new URL(location, url);
      continue;
    }

    if (status < 200 || status >= 300) {
      response.destroy();
      throw new WebsiteLogoError(`Fetch failed: ${status}`);
    }

    const declared = Number(response.headers["content-length"] ?? 0);
    if (declared > maxBytes) {
      response.destroy();
      throw new WebsiteLogoError("Response too large");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const value of response) {
      total += value.byteLength;
      if (total > maxBytes) {
        response.destroy();
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

    return { bytes, contentType: response.headers["content-type"]?.split(";")[0].trim() ?? "", url };
  }

  throw new WebsiteLogoError("Too many redirects");
}

async function resolvePublicHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebsiteLogoError("Blocked address");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await lookup(host, { all: true }).catch(() => []);

  if (addresses.length === 0) throw new WebsiteLogoError("Website not found");
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new WebsiteLogoError("Blocked address");
  return addresses;
}

export function isPrivateAddress(address: string) {
  const family = isIP(address);
  return family === 0 || privateAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

function readAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? match[4] ?? "").trim() : null;
}
