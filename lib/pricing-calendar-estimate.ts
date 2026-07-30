import { getEmailDomain, isCommonPersonalEmailDomain } from "@/lib/email-domains";

/** How far back we read the calendar to measure a real meeting habit. */
export const CALENDAR_LOOKBACK_DAYS = 90;

/** Average days per month, used to turn a lookback window into a monthly rate. */
export const DAYS_PER_MONTH = 30.44;

/** A meeting needs at least two participants; solo blocks are not meetings. */
const MINIMUM_ATTENDEES = 2;

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
};

export type CalendarUsageSummary = {
  /** How many teammates the visitor selected. */
  selectedTeamSize: number;
  /** Distinct meetings recorded once each, per month. */
  recordedMeetingHoursPerMonth: number;
  /** Meeting time summed across selected attendees, per month. */
  personMeetingHoursPerMonth: number;
  /** Count of distinct recorded meetings per month. */
  recordedMeetingCountPerMonth: number;
};

type RawGoogleEvent = {
  status?: unknown;
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
 * Turns raw Google Calendar events into a compact payload the browser can
 * re-aggregate locally as the visitor changes who counts as their team.
 *
 * "Internal" means the same email domain as the connected account, which is how
 * the rest of the product decides whether an attendee is a colleague.
 */
export function buildCalendarEstimatePayload(input: {
  organizerEmail: string;
  rawEvents: readonly unknown[];
  lookbackDays?: number;
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

    if (!event || getString(event.status) === "cancelled") {
      skippedEventCount += 1;
      continue;
    }

    const startedAt = getEventTime(event.start);
    const endedAt = getEventTime(event.end);

    if (startedAt === null || endedAt === null || endedAt <= startedAt) {
      skippedEventCount += 1;
      continue;
    }

    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const internalAttendeeIndexes: number[] = [];
    const seenOnThisEvent = new Set<string>();
    let totalAttendeeCount = 0;

    for (const rawAttendee of attendees) {
      const attendee = asRecord(rawAttendee);

      if (!attendee || attendee.resource === true) {
        // Meeting rooms are invitees but not people.
        continue;
      }

      const email = getString(attendee.email)?.toLowerCase();

      if (!email || seenOnThisEvent.has(email)) {
        continue;
      }

      seenOnThisEvent.add(email);
      totalAttendeeCount += 1;

      if (!internalDomain || getEmailDomain(email) !== internalDomain) {
        continue;
      }

      const index = internEmail(email, getString(attendee.displayName));

      if (index !== null) {
        internalAttendeeIndexes.push(index);
      }
    }

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
      hours: (endedAt - startedAt) / (60 * 60 * 1000),
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
  };
}

/**
 * Aggregates the payload for the currently selected teammates.
 *
 * A meeting several selected colleagues attend is recorded once, so its hours
 * land in `recordedMeetingHoursPerMonth` a single time while
 * `personMeetingHoursPerMonth` counts it per attendee — the gap between those
 * two numbers is exactly what per-seat pricing overcharges for.
 */
export function summarizeCalendarUsage(
  payload: CalendarEstimatePayload,
  selectedEmails: readonly string[],
): CalendarUsageSummary {
  const selected = new Set(
    selectedEmails.map((email) => email.trim().toLowerCase()),
  );
  const selectedIndexes = new Set<number>();

  payload.people.forEach((person, index) => {
    if (selected.has(person.email)) {
      selectedIndexes.add(index);
    }
  });

  let recordedHours = 0;
  let personHours = 0;
  let recordedCount = 0;

  for (const event of payload.events) {
    const attendingCount = event.internalAttendeeIndexes.filter((index) =>
      selectedIndexes.has(index),
    ).length;

    if (attendingCount === 0) {
      continue;
    }

    // Recorded once, no matter how many of the selected people were on it.
    recordedHours += event.hours;
    recordedCount += 1;
    personHours += event.hours * attendingCount;
  }

  const monthlyFactor =
    payload.lookbackDays > 0 ? DAYS_PER_MONTH / payload.lookbackDays : 0;

  return {
    selectedTeamSize: selectedIndexes.size,
    recordedMeetingHoursPerMonth: recordedHours * monthlyFactor,
    personMeetingHoursPerMonth: personHours * monthlyFactor,
    recordedMeetingCountPerMonth: recordedCount * monthlyFactor,
  };
}
