const defaultCallbackURL = "/dashboard";

export function buildGoogleSignInOptions(callbackURL?: string | string[]) {
  return {
    provider: "google" as const,
    callbackURL: normalizeGoogleSignInCallbackURL(callbackURL),
    errorCallbackURL: "/auth/sign-in",
  };
}

function normalizeGoogleSignInCallbackURL(
  value?: string | string[],
) {
  const callbackURL = Array.isArray(value) ? value[0] : value;

  if (!callbackURL || callbackURL.startsWith("//")) {
    return defaultCallbackURL;
  }

  try {
    const parsed = new URL(callbackURL, "https://meetingnote.local");

    if (
      parsed.origin !== "https://meetingnote.local" ||
      !callbackURL.startsWith("/")
    ) {
      return defaultCallbackURL;
    }

    const query = parsed.searchParams.toString();
    const search = query ? `?${query}` : "";

    return `${parsed.pathname}${search}${parsed.hash}`;
  } catch {
    return defaultCallbackURL;
  }
}
