export const runtime = "nodejs";

const foundCacheControl =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400";
const missingCacheControl =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"));

  if (!domain) {
    return new Response(null, { status: 404 });
  }

  const response = await fetch(getDuckDuckGoFaviconUrl(domain), {
    redirect: "follow",
  }).catch(() => null);

  if (!response?.ok) {
    return new Response(null, {
      headers: {
        "Cache-Control": missingCacheControl,
      },
      status: 404,
    });
  }

  const contentType = response.headers.get("content-type") ?? "image/x-icon";

  if (!contentType.toLowerCase().startsWith("image/")) {
    return new Response(null, {
      headers: {
        "Cache-Control": missingCacheControl,
      },
      status: 404,
    });
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      "Cache-Control": foundCacheControl,
      "Content-Type": contentType,
    },
  });
}

function getDuckDuckGoFaviconUrl(domain: string) {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

function normalizeDomain(value: string | null) {
  const domain = value?.trim().toLowerCase().replace(/^www\./, "");

  if (!domain || domain.includes("@")) {
    return null;
  }

  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : null;
}
