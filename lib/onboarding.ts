export function getOnboardingHiddenCookieName({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}) {
  return `tape_onboarding_hidden_${userId}_${teamId}`;
}

export function getConfiguredMcpServerAddress(
  rawBaseUrl = process.env.MCP_BASE_URL,
) {
  if (!rawBaseUrl?.trim()) {
    return null;
  }

  try {
    const url = new URL(rawBaseUrl);
    const isLocalHttp =
      url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);

    if (url.protocol !== "https:" && !isLocalHttp) {
      return null;
    }

    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.endsWith("/mcp")
      ? pathname
      : `${pathname}/mcp`;

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
