export type SupportedMeetingPlatform = "google_meet" | "zoom";

export function detectMeetingPlatform(
  meetingUrl: string,
): SupportedMeetingPlatform | null {
  let url: URL;

  try {
    url = new URL(meetingUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "meet.google.com") {
    return "google_meet";
  }

  if (
    (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) &&
    url.pathname.startsWith("/j/")
  ) {
    return "zoom";
  }

  return null;
}

export function buildAppUrl(pathname: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is required");
  }

  return new URL(pathname, baseUrl).toString();
}
