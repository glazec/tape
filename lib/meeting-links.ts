export type SupportedMeetingPlatform = "google_meet" | "zoom";

export function detectMeetingPlatform(
  meetingUrl: string,
): SupportedMeetingPlatform | null {
  const url = parseMeetingUrl(meetingUrl);

  if (!url) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "meet.google.com") {
    return "google_meet";
  }

  if (
    (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) &&
    (url.pathname.startsWith("/j/") || url.pathname.startsWith("/my/"))
  ) {
    return "zoom";
  }

  return null;
}

export async function resolveMeetingJoinUrl(meetingUrl: string) {
  const canonicalUrl = canonicalizeMeetingUrl(meetingUrl);

  if (!isZoomPersonalRoomUrl(meetingUrl)) {
    return canonicalUrl;
  }

  try {
    const response = await fetch(meetingUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const location = response.headers.get("location");

    if (location && detectMeetingPlatform(location) === "zoom") {
      return canonicalizeMeetingUrl(location);
    }
  } catch {
    return canonicalUrl;
  }

  return canonicalUrl;
}

function canonicalizeMeetingUrl(meetingUrl: string) {
  const url = parseMeetingUrl(meetingUrl);

  if (!url) {
    return meetingUrl;
  }

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/$/, "");

  if (
    (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) &&
    url.pathname.startsWith("/j/")
  ) {
    url.hostname = "zoom.us";
    for (const key of Array.from(url.searchParams.keys())) {
      if (key !== "pwd") {
        url.searchParams.delete(key);
      }
    }
  }

  return url.toString().replace(/\/$/, "");
}

export function buildAppUrl(pathname: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is required");
  }

  return new URL(pathname, baseUrl).toString();
}

function isZoomPersonalRoomUrl(meetingUrl: string) {
  const url = parseMeetingUrl(meetingUrl);

  return Boolean(
    url &&
      (url.hostname.toLowerCase() === "zoom.us" ||
        url.hostname.toLowerCase().endsWith(".zoom.us")) &&
      url.pathname.startsWith("/my/"),
  );
}

function parseMeetingUrl(meetingUrl: string) {
  try {
    return new URL(meetingUrl);
  } catch {
    return null;
  }
}
