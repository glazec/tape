import {
  getEmailDomain,
  isCommonPersonalEmailDomain,
} from "@/lib/email-domains";

/** How far back we read the calendar to measure a real meeting habit. */
export const CALENDAR_LOOKBACK_DAYS = 90;

/** Average days per month, used to turn a lookback window into a monthly rate. */
export const DAYS_PER_MONTH = 30.44;

/** A meeting needs at least two participants; solo blocks are not meetings. */
const MINIMUM_ATTENDEES = 2;

/** Longer timed blocks are not representative recordable meetings. */
export const MAX_MEETING_DURATION_HOURS = 12;

/** Guards against a pathological calendar producing an unusable payload. */
const MAX_PEOPLE = 300;

export type CalendarEstimatePerson = {
  email: string;
  name: string | null;
  /** Meetings this person shared with the connected account in the window. */
  meetingCount: number;
  /** True for the account that connected the calendar. */
  isSelf: boolean;
};

export type CalendarEstimateEvent = {
  /** Meeting length in hours. */
  hours: number;
  /** Indexes into `people` for the internal attendees on this meeting. */
  internalAttendeeIndexes: number[];
  /** Total invitees including external guests, used only to skip solo blocks. */
  totalAttendeeCount: number;
};

export type CalendarEstimatePayload = {
  organizerEmail: string;
  organizerDomain: string;
  lookbackDays: number;
  people: CalendarEstimatePerson[];
  events: CalendarEstimateEvent[];
  /** Events read from Google before filtering, for an honest "we saw N" note. */
  scannedEventCount: number;
  /** Events skipped because they were solo blocks or had no usable times. */
  skippedEventCount: number;
  /** True when Google had more events than the bounded calendar read retained. */
  eventLimitReached: boolean;
};

export type ConnectedCalendarSummary = {
  /** Same-domain people observed, including the connected person. */
  inferredTeamSize: number;
  /** Scheduled meeting time measured on the connected person's calendar. */
  observedMeetingHoursPerWeek: number;
  /** Qualifying meetings normalized to one month. */
  observedMeetingCountPerMonth: number;
  /** Number of qualifying event instances in the lookback window. */
  qualifyingEventCount: number;
};

type RawGoogleEvent = {
  status?: unknown;
  eventType?: unknown;
  start?: unknown;
  end?: unknown;
  attendees?: unknown;
  organizer?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reads a Google event date node, which is `dateTime` for timed meetings. */
function getEventTime(node: unknown) {
  const record = asRecord(node);

  if (!record) {
    return null;
  }

  // All-day events expose `date` only; they are not meetings we would record.
  const dateTime = getString(record.dateTime);

  if (!dateTime) {
    return null;
  }

  const parsed = new Date(dateTime).getTime();

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns raw Google Calendar events into a compact payload that can prefill the
 * visitor's editable pricing assumptions.
 *
 * "Internal" means the same email domain as the connected account, which is how
 * the rest of the product decides whether an attendee is a colleague.
 */
export function buildCalendarEstimatePayload(input: {
  organizerEmail: string;
  rawEvents: readonly unknown[];
  lookbackDays?: number;
  eventLimitReached?: boolean;
}): CalendarEstimatePayload {
  const organizerEmail = input.organizerEmail.trim().toLowerCase();
  const organizerDomain = getEmailDomain(organizerEmail);
  const lookbackDays = input.lookbackDays ?? CALENDAR_LOOKBACK_DAYS;

  // A personal Google account has no colleagues to separate from guests, so
  // there is no internal domain to group on.
  const internalDomain =
    organizerDomain && !isCommonPersonalEmailDomain(organizerDomain)
      ? organizerDomain
      : null;

  const peopleIndexByEmail = new Map<string, number>();
  const people: CalendarEstimatePerson[] = [];
  const events: CalendarEstimateEvent[] = [];
  let skippedEventCount = 0;

  function internEmail(email: string, name: string | null) {
    const existingIndex = peopleIndexByEmail.get(email);

    if (existingIndex !== undefined) {
      const person = people[existingIndex];

      if (!person.name && name) {
        person.name = name;
      }

      return existingIndex;
    }

    if (people.length >= MAX_PEOPLE) {
      return null;
    }

    const index = people.length;
    people.push({
      email,
      name,
      meetingCount: 0,
      isSelf: email === organizerEmail,
    });
    peopleIndexByEmail.set(email, index);

    return index;
  }

  for (const rawEvent of input.rawEvents) {
    const event = asRecord(rawEvent) as RawGoogleEvent | null;

    if (
      !event ||
      getString(event.status) === "cancelled" ||
      (getString(event.eventType) !== null &&
        getString(event.eventType) !== "default")
    ) {
      skippedEventCount += 1;
      continue;
    }

    const startedAt = getEventTime(event.start);
    const endedAt = getEventTime(event.end);

    if (startedAt === null || endedAt === null || endedAt <= startedAt) {
      skippedEventCount += 1;
      continue;
    }

    const durationHours = (endedAt - startedAt) / (60 * 60 * 1000);

    if (durationHours > MAX_MEETING_DURATION_HOURS) {
      skippedEventCount += 1;
      continue;
    }

    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const participants = new Map<
      string,
      { email: string; name: string | null; isSelf: boolean }
    >();
    let connectedPersonDeclined = false;

    for (const rawAttendee of attendees) {
      const attendee = asRecord(rawAttendee);

      if (!attendee || attendee.resource === true) {
        // Meeting rooms are invitees but not people.
        continue;
      }

      const attendeeEmail = getString(attendee.email)?.toLowerCase();
      const isSelf = attendee.self === true || attendeeEmail === organizerEmail;

      if (!attendeeEmail) {
        continue;
      }

      if (isSelf && getString(attendee.responseStatus) === "declined") {
        connectedPersonDeclined = true;
        continue;
      }

      if (getString(attendee.responseStatus) === "declined") {
        continue;
      }

      // `self` is more reliable than matching an alias to the userinfo email.
      const email = isSelf ? organizerEmail : attendeeEmail;
      participants.set(email, {
        email,
        name: getString(attendee.displayName),
        isSelf,
      });
    }

    const organizer = asRecord(event.organizer);
    const organizerEventEmail = organizer
      ? getString(organizer.email)?.toLowerCase()
      : null;
    const organizerIsSelf =
      organizer?.self === true || organizerEventEmail === organizerEmail;

    if (organizerEventEmail || organizerIsSelf) {
      const email = organizerIsSelf
        ? organizerEmail
        : (organizerEventEmail as string);
      const existing = participants.get(email);
      participants.set(email, {
        email,
        name: existing?.name ?? null,
        isSelf: organizerIsSelf || existing?.isSelf === true,
      });
    }

    if (connectedPersonDeclined || !participants.has(organizerEmail)) {
      skippedEventCount += 1;
      continue;
    }

    const internalAttendeeIndexes: number[] = [];

    for (const participant of participants.values()) {
      const isInternal =
        participant.isSelf ||
        (internalDomain !== null &&
          getEmailDomain(participant.email) === internalDomain);

      if (!isInternal) {
        continue;
      }

      const index = internEmail(participant.email, participant.name);

      if (index !== null) {
        internalAttendeeIndexes.push(index);
      }
    }

    const totalAttendeeCount = participants.size;

    if (
      totalAttendeeCount < MINIMUM_ATTENDEES ||
      internalAttendeeIndexes.length === 0
    ) {
      skippedEventCount += 1;
      continue;
    }

    for (const index of internalAttendeeIndexes) {
      people[index].meetingCount += 1;
    }

    events.push({
      hours: durationHours,
      internalAttendeeIndexes,
      totalAttendeeCount,
    });
  }

  // Busiest colleagues first so the picker leads with the real team.
  const order = people
    .map((person, index) => ({ person, index }))
    .sort((left, right) => {
      if (left.person.isSelf !== right.person.isSelf) {
        return left.person.isSelf ? -1 : 1;
      }

      return right.person.meetingCount - left.person.meetingCount;
    });
  const remappedIndexByOldIndex = new Map<number, number>();

  order.forEach((entry, newIndex) => {
    remappedIndexByOldIndex.set(entry.index, newIndex);
  });

  return {
    organizerEmail,
    organizerDomain: internalDomain ?? "",
    lookbackDays,
    people: order.map((entry) => entry.person),
    events: events.map((event) => ({
      ...event,
      internalAttendeeIndexes: event.internalAttendeeIndexes.map(
        (index) => remappedIndexByOldIndex.get(index) ?? index,
      ),
    })),
    scannedEventCount: input.rawEvents.length,
    skippedEventCount,
    eventLimitReached: input.eventLimitReached === true,
  };
}

/**
 * Treats the connected person's primary calendar as one representative sample.
 * Tape-user overlap remains an explicit visitor assumption because Google
 * cannot tell which same-domain attendees will use Tape.
 */
export function summarizeConnectedCalendar(
  payload: CalendarEstimatePayload,
): ConnectedCalendarSummary {
  const selfIndex = payload.people.findIndex((person) => person.isSelf);
  let observedMeetingHours = 0;
  let qualifyingEventCount = 0;

  if (selfIndex >= 0) {
    for (const event of payload.events) {
      if (!event.internalAttendeeIndexes.includes(selfIndex)) {
        continue;
      }

      observedMeetingHours += event.hours;
      qualifyingEventCount += 1;
    }
  }

  const weeklyFactor = payload.lookbackDays > 0 ? 7 / payload.lookbackDays : 0;
  const monthlyFactor =
    payload.lookbackDays > 0 ? DAYS_PER_MONTH / payload.lookbackDays : 0;

  return {
    inferredTeamSize: Math.max(1, payload.people.length),
    observedMeetingHoursPerWeek: observedMeetingHours * weeklyFactor,
    observedMeetingCountPerMonth: qualifyingEventCount * monthlyFactor,
    qualifyingEventCount,
  };
}
