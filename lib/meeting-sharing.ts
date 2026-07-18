import {
  getExternalParticipantKeys,
  getMeetingSimilarityKeys,
} from "@/lib/meeting-intelligence";

export function getMeetingShareMatchKeys(input: {
  attendeeEmails: unknown;
  title: string;
  workspaceDomain: string;
}) {
  return getMeetingSimilarityKeys(
    {
      title: input.title,
      externalParticipantKeys: getExternalParticipantKeys(
        input.attendeeEmails,
        input.workspaceDomain,
      ),
    },
    {},
  );
}

const PARTICIPANT_EMAIL_PREFIX = "participant:email:";
const PARTICIPANT_DOMAIN_PREFIX = "participant:domain:";
const TITLE_PREFIX = "title:";

export function hasReliableMeetingShareMatchKeys(matchKeys: string[]) {
  return (
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
    hasSharedKey(PARTICIPANT_EMAIL_PREFIX) ||
    (hasSharedKey(TITLE_PREFIX) && hasSharedKey(PARTICIPANT_DOMAIN_PREFIX))
  );
}
