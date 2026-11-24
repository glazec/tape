import {
  getExternalParticipantKeys,
  getMeetingSimilarityKeys,
} from "@/lib/meeting-intelligence";

export function getMeetingShareMatchKeys(input: {
  attendeeEmails: unknown;
  connectionId?: string | null;
  externalEventId?: string | null;
  title: string;
  workspaceDomain: string;
}) {
  const keys = getMeetingSimilarityKeys(
    {
      title: input.title,
      externalParticipantKeys: getExternalParticipantKeys(
        input.attendeeEmails,
        input.workspaceDomain,
      ),
    },
    {},
  );
  const seriesKey = getCalendarSeriesKey(input.connectionId, input.externalEventId);
  if (seriesKey) keys.push(seriesKey);
  return keys;
}

// Google Calendar occurrence IDs retain the series ID before the original start.
export function getCalendarSeriesKey(connectionId?: string | null, externalEventId?: string | null) {
  const series = externalEventId?.match(/^([a-z0-9]+)_\d{8}(?:T\d{6}Z)?$/i)?.[1];
  return series && connectionId ? `series:${connectionId}:${series}` : null;
}

const PARTICIPANT_EMAIL_PREFIX = "participant:email:";
const PARTICIPANT_DOMAIN_PREFIX = "participant:domain:";
const TITLE_PREFIX = "title:";

export function hasReliableMeetingShareMatchKeys(matchKeys: string[]) {
  return (
    matchKeys.some((key) => key.startsWith("series:")) ||
    matchKeys.some((key) => key.startsWith(PARTICIPANT_EMAIL_PREFIX)) ||
    (matchKeys.some((key) => key.startsWith(TITLE_PREFIX)) &&
      matchKeys.some((key) => key.startsWith(PARTICIPANT_DOMAIN_PREFIX)))
  );
}

export function meetingsShareReliableMatch(
  leftKeys: string[],
  rightKeys: string[],
) {
  const left = new Set(leftKeys);
  const hasSharedKey = (prefix: string) =>
    rightKeys.some((key) => key.startsWith(prefix) && left.has(key));

  return (
    hasSharedKey("series:") ||
    hasSharedKey(PARTICIPANT_EMAIL_PREFIX) ||
    (hasSharedKey(TITLE_PREFIX) && hasSharedKey(PARTICIPANT_DOMAIN_PREFIX))
  );
}
