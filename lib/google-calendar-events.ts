const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Google caps `maxResults` at 2500; 250 keeps each response small. */
const PAGE_SIZE = 250;

/** Bounds a busy calendar so one visitor cannot trigger an unbounded crawl. */
const MAX_PAGES = 8;

export class GoogleCalendarReadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleCalendarReadError";
    this.status = status;
  }
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reads the email of the account that granted access. */
export async function fetchGoogleAccountEmail(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GoogleCalendarReadError(
      "Could not read the Google account email",
      response.status,
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    email?: unknown;
  };
  const email = getString(data.email);

  if (!email) {
    throw new GoogleCalendarReadError(
      "Google did not return an account email",
      502,
    );
  }

  return email.toLowerCase();
}

/**
 * Lists past events from the primary calendar. `singleEvents` expands recurring
 * meetings into individual instances so each occurrence is priced once.
 */
export async function fetchGoogleCalendarEvents(input: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
}) {
  const events: unknown[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(GOOGLE_EVENTS_URL);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    url.searchParams.set("timeMin", input.timeMin.toISOString());
    url.searchParams.set("timeMax", input.timeMax.toISOString());
    // Only the fields the estimate needs, so we never pull meeting bodies.
    url.searchParams.set(
      "fields",
      "nextPageToken,items(status,start/dateTime,end/dateTime,attendees(email,displayName,resource))",
    );

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new GoogleCalendarReadError(
        "Could not read the Google calendar",
        response.status,
      );
    }

    const data = (await response.json().catch(() => ({}))) as {
      items?: unknown;
      nextPageToken?: unknown;
    };

    if (Array.isArray(data.items)) {
      events.push(...data.items);
    }

    pageToken = getString(data.nextPageToken);

    if (!pageToken) {
      break;
    }
  }

  return events;
}
