import {
  getEmailDomain,
  getExternalOrganizationDomain,
  isCommonPersonalEmailDomain,
  normalizeEmailAddress,
} from "@/lib/email-domains";
import { formatNameFromEmail } from "@/lib/speaker-labels";
import {
  formatOrganizationName,
  getWorkspaceDisplayName,
} from "@/lib/team-name";

type VocabularyTerm = {
  term: string;
  hint?: string | null;
};

const ELEVENLABS_BATCH_KEYTERM_LIMIT = 1000;
const ELEVENLABS_BATCH_KEYTERM_MAX_LENGTH = 50;
const ELEVENLABS_BATCH_KEYTERM_MAX_SPACES = 4;

type EntitySegment = {
  id: string;
  text: string;
};

type MeetingEntityType =
  | "meeting_link"
  | "money"
  | "name"
  | "organization"
  | "product";
type MeetingEntitySource =
  | "calendar"
  | "elevenlabs"
  | "meeting_url"
  | "transcript";

export type ExtractedMeetingEntity = {
  aliases: string[];
  segmentId: string | null;
  source: MeetingEntitySource;
  type: MeetingEntityType;
  value: string;
  normalizedValue: string;
};

export type TranscriptDetectedEntity = {
  source?: MeetingEntitySource;
  type: string;
  value: string;
};

type OrganizationDomain = {
  domain: string;
  name: string;
};

type EntityExtractionContext = {
  attendeeEmails?: string[];
  meetingUrl?: string | null;
  organizationDomains?: OrganizationDomain[];
  transcriptEntities?: TranscriptDetectedEntity[];
  workspaceDomain?: string | null;
};

export type SegmentEmotion = {
  label: "hard" | "chill" | "neutral";
  reason: string;
};

type MeetingForGrouping = {
  id: string;
  title: string;
  startedAt: string;
  primaryEntity?: string | null;
  externalParticipantKeys?: string[];
};

type GroupRelatedMeetingsOptions = {
  includeTitleKeys?: boolean;
};

const genericMeetingTitles = new Set([
  "google meet",
  "google meet recording",
  "meeting",
  "zoom",
  "zoom meeting",
  "zoom recording",
]);
const genericMeetingGroupingTitles = new Set([
  ...genericMeetingTitles,
  "recording",
  "untitled meeting",
  "uploaded audio",
]);

const hardSignals = [
  "blocked",
  "concern",
  "deadline",
  "hard",
  "issue",
  "problem",
  "risk",
  "urgent",
];
const chillSignals = ["chill", "cool", "easy", "fine", "relaxed", "steady"];

export function buildTeamVocabularyKeyterms(terms: VocabularyTerm[]) {
  return buildTranscriptionKeyterms(terms.map((item) => item.term));
}

export function buildTranscriptionKeyterms(...termGroups: string[][]) {
  const seen = new Set<string>();
  const keyterms: string[] = [];

  for (const rawTerm of termGroups.flat()) {
    const term = rawTerm.replace(/\s+/g, " ").trim();
    const key = term.toLowerCase();

    if (
      !term ||
      term.length > ELEVENLABS_BATCH_KEYTERM_MAX_LENGTH ||
      countSpaces(term) > ELEVENLABS_BATCH_KEYTERM_MAX_SPACES ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    keyterms.push(term);

    if (keyterms.length >= ELEVENLABS_BATCH_KEYTERM_LIMIT) {
      break;
    }
  }

  return keyterms;
}

function countSpaces(value: string) {
  return (value.match(/ /g) ?? []).length;
}

export function buildSmartMeetingTitle(input: {
  eventTitle: string;
  attendeeEmails: string[];
  workspaceDomain: string;
  workspaceName?: string | null;
}) {
  const eventTitle = input.eventTitle.replace(/\s+/g, " ").trim();
  const workspaceName = getWorkspaceDisplayName(
    input.workspaceDomain,
    input.workspaceName,
  );
  const domainWorkspaceName = getWorkspaceDisplayName(input.workspaceDomain);
  const normalizedEventTitle = normalizeEntityValue(eventTitle);
  const normalizedWorkspaceName = normalizeEntityValue(workspaceName);
  const normalizedDomainWorkspaceName = normalizeEntityValue(
    domainWorkspaceName,
  );
  const isWorkspaceDefaultTitle =
    normalizedEventTitle === normalizedWorkspaceName ||
    normalizedEventTitle === `meeting with ${normalizedWorkspaceName}` ||
    normalizedEventTitle === normalizedDomainWorkspaceName ||
    normalizedEventTitle === `meeting with ${normalizedDomainWorkspaceName}`;

  if (
    eventTitle &&
    !genericMeetingTitles.has(eventTitle.toLowerCase()) &&
    !isWorkspaceDefaultTitle
  ) {
    return eventTitle;
  }

  const externalParticipantName = getExternalMeetingParticipantName(
    input.attendeeEmails,
    input.workspaceDomain,
  );

  if (!externalParticipantName) {
    return eventTitle || "Meeting";
  }

  return `${workspaceName} <> ${externalParticipantName}`;
}

export function extractMeetingEntities(
  segments: EntitySegment[],
  context: EntityExtractionContext = {},
): ExtractedMeetingEntity[] {
  const entities: ExtractedMeetingEntity[] = [];
  const workspaceEntity = getWorkspaceOrganizationEntity(context.workspaceDomain);

  for (const entity of context.transcriptEntities ?? []) {
    if (!isSupportedEntityType(entity.type)) {
      continue;
    }

    if (
      entity.type.toLowerCase() === "organization" &&
      isWorkspaceOrganizationEntity(entity.value, workspaceEntity)
    ) {
      continue;
    }

    addOrMergeEntity({
      aliases:
        entity.type.toLowerCase() === "organization"
          ? mergeAliases(
              buildOrganizationAliases(entity.value),
              getOrganizationDomainAliases(
                entity.value,
                context.organizationDomains,
              ),
            )
          : [],
      entities,
      segmentId: findSegmentIdForEntity(segments, entity.value),
      source: entity.source ?? "elevenlabs",
      type: entity.type.toLowerCase() as MeetingEntityType,
      value: entity.value,
    });
  }

  for (const email of context.attendeeEmails ?? []) {
    const domain = getExternalOrganizationDomain(email, context.workspaceDomain);

    if (!domain) {
      continue;
    }

    addOrMergeEntity({
      aliases: [domain],
      entities,
      segmentId: null,
      source: "calendar",
      type: "organization",
      value: domain,
    });
  }

  const meetingLinkEntity = buildMeetingLinkEntity(context.meetingUrl);

  if (meetingLinkEntity) {
    addOrMergeEntity({
      aliases: [meetingLinkEntity.alias],
      entities,
      segmentId: null,
      source: "meeting_url",
      type: "meeting_link",
      value: meetingLinkEntity.value,
      normalizedValue: meetingLinkEntity.normalizedValue,
    });
  }

  return entities;
}

export function classifySegmentEmotion(input: {
  text: string;
  startMs: number;
  endMs: number | null;
}): SegmentEmotion {
  const normalized = input.text.toLowerCase();
  const wordCount = input.text.trim().split(/\s+/).filter(Boolean).length;
  const durationMinutes =
    input.endMs && input.endMs > input.startMs
      ? (input.endMs - input.startMs) / 60000
      : 0;
  const wordsPerMinute = durationMinutes ? wordCount / durationMinutes : 0;
  const hardScore =
    countSignals(normalized, hardSignals) +
    (wordCount >= 8 && wordsPerMinute >= 150 ? 1 : 0);
  const chillScore =
    countSignals(normalized, chillSignals) + (wordsPerMinute > 0 && wordsPerMinute <= 110 ? 1 : 0);

  if (hardScore > chillScore && hardScore > 0) {
    return { label: "hard", reason: "High pressure words or fast pace" };
  }

  if (chillScore > 0) {
    return { label: "chill", reason: "Calm words or slower pace" };
  }

  return { label: "neutral", reason: "No strong signal" };
}

export function groupRelatedMeetings(
  meetings: MeetingForGrouping[],
  options: GroupRelatedMeetingsOptions = {},
) {
  const sorted = [...meetings].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const rootByKey = new Map<string, MeetingForGrouping>();
  const childrenByRoot = new Map<string, MeetingForGrouping[]>();
  const roots: MeetingForGrouping[] = [];

  for (const meeting of sorted) {
    const keys = getMeetingSimilarityKeys(meeting, options);

    if (keys.length === 0) {
      roots.push(meeting);
      childrenByRoot.set(meeting.id, []);
      continue;
    }

    const existingRoot = keys
      .map((key) => rootByKey.get(key))
      .find((root): root is MeetingForGrouping => Boolean(root));

    if (!existingRoot) {
      for (const key of keys) {
        rootByKey.set(key, meeting);
      }
      childrenByRoot.set(meeting.id, []);
      roots.push(meeting);
      continue;
    }

    for (const key of keys) {
      rootByKey.set(key, existingRoot);
    }
    childrenByRoot.get(existingRoot.id)?.push(meeting);
  }

  return roots.map((meeting) => ({
    id: meeting.id,
    relatedMeetings: (childrenByRoot.get(meeting.id) ?? []).map((child) => ({
      id: child.id,
      title: child.title,
      startedAt: child.startedAt,
    })),
  }));
}

function addOrMergeEntity(input: {
  aliases?: string[];
  entities: ExtractedMeetingEntity[];
  normalizedValue?: string;
  segmentId: string | null;
  source: MeetingEntitySource;
  type: MeetingEntityType;
  value: string;
}) {
  const value =
    input.type === "organization"
      ? canonicalizeOrganizationName(input.value)
      : input.value;
  const normalizedValue = input.normalizedValue ?? normalizeEntityValue(value);

  if (!normalizedValue) {
    return;
  }

  const existing = input.entities.find(
    (entity) =>
      entity.type === input.type && entity.normalizedValue === normalizedValue,
  );

  if (existing) {
    existing.aliases = mergeAliases(existing.aliases, input.aliases ?? []);
    if (input.source === "elevenlabs") {
      existing.source = input.source;
    }
    if (!existing.segmentId && input.segmentId) {
      existing.segmentId = input.segmentId;
    }
    return;
  }

  input.entities.push({
    aliases: mergeAliases([], input.aliases ?? []),
    segmentId: input.segmentId,
    source: input.source,
    type: input.type,
    value,
    normalizedValue,
  });
}

function normalizeEntityValue(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isSupportedEntityType(type: string) {
  const normalized = type.toLowerCase();

  return (
    normalized === "money" ||
    normalized === "name" ||
    normalized === "organization" ||
    normalized === "product"
  );
}

function buildOrganizationAliases(value: string) {
  const aliases: string[] = [];
  const trimmed = value.trim();
  const domain = looksLikeDomain(trimmed) ? trimmed.toLowerCase() : null;

  if (trimmed && trimmed !== canonicalizeOrganizationName(trimmed)) {
    aliases.push(trimmed);
  }

  if (domain && domain !== trimmed) {
    aliases.push(domain);
  }

  return aliases;
}

function getOrganizationDomainAliases(
  value: string,
  organizationDomains: OrganizationDomain[] = [],
) {
  return organizationDomains
    .filter((company) => isOrganizationDomainMatch(value, company))
    .map((company) => company.domain.trim().toLowerCase())
    .filter(Boolean);
}

function isOrganizationDomainMatch(value: string, company: OrganizationDomain) {
  const entityKey = normalizeEntityValue(canonicalizeOrganizationName(value));
  const companyNameKey = normalizeEntityValue(
    canonicalizeOrganizationName(company.name),
  );
  const domainNameKey = normalizeEntityValue(formatOrganizationName(company.domain));

  return (
    Boolean(entityKey) &&
    (companyNameKey === entityKey ||
      companyNameKey.startsWith(`${entityKey} `) ||
      entityKey.startsWith(`${companyNameKey} `) ||
      domainNameKey === entityKey)
  );
}

function canonicalizeOrganizationName(value: string) {
  return formatOrganizationName(value.trim());
}

function mergeAliases(left: string[], right: string[]) {
  const aliases: string[] = [...left];
  const seen = new Set(left.map((alias) => alias.toLowerCase()));

  for (const alias of right) {
    const trimmed = alias.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    aliases.push(trimmed);
  }

  return aliases;
}

function findSegmentIdForEntity(segments: EntitySegment[], value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  return (
    segments.find((segment) =>
      new RegExp(`\\b${escapeRegExp(normalizedValue)}\\b`, "i").test(
        segment.text,
      ),
    )?.id ??
    segments.find((segment) =>
      segment.text
        .toLowerCase()
        .includes(canonicalizeOrganizationName(normalizedValue).toLowerCase()),
    )?.id ??
    null
  );
}

function looksLikeDomain(value: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

function buildMeetingLinkEntity(meetingUrl?: string | null) {
  if (!meetingUrl) {
    return null;
  }

  try {
    const url = new URL(meetingUrl);
    const normalizedValue = `${url.hostname.toLowerCase()}${url.pathname}`
      .replace(/\/+$/, "")
      .replace(/^\//, "");

    return {
      alias: meetingUrl,
      value: url.hostname.toLowerCase(),
      normalizedValue,
    };
  } catch {
    return null;
  }
}

export function getMeetingSimilarityKeys(
  meeting: Pick<
    MeetingForGrouping,
    "title" | "primaryEntity" | "externalParticipantKeys"
  >,
  options: GroupRelatedMeetingsOptions,
) {
  const keys: string[] = [];

  if (options.includeTitleKeys !== false) {
    const titleKey = getMeetingTitleGroupingKey(meeting.title);

    if (titleKey) {
      keys.push(`title:${titleKey}`);
    }
  }

  for (const participant of meeting.externalParticipantKeys ?? []) {
    const normalized = participant.trim().toLowerCase();

    if (normalized) {
      keys.push(`participant:${normalized}`);
    }
  }

  return keys;
}

export function getExternalParticipantKeys(
  attendeeEmails: unknown,
  workspaceDomain: string,
) {
  if (!Array.isArray(attendeeEmails)) {
    return [];
  }

  const normalizedWorkspaceDomain = workspaceDomain.trim().toLowerCase();
  const keys = new Set<string>();

  for (const rawEmail of attendeeEmails) {
    if (typeof rawEmail !== "string") {
      continue;
    }

    const email = normalizeEmailAddress(rawEmail);
    const domain = getEmailDomain(email);

    if (!email || !domain || domain === normalizedWorkspaceDomain) {
      continue;
    }

    keys.add(`email:${email}`);

    if (!isCommonPersonalEmailDomain(domain)) {
      keys.add(`domain:${domain}`);
    }
  }

  return Array.from(keys);
}

function getMeetingTitleGroupingKey(title: string) {
  const companyPairKey = getCompanyPairTitleGroupingKey(title);

  if (companyPairKey) {
    return companyPairKey;
  }

  const normalized = normalizeEntityValue(title);

  if (!normalized || genericMeetingGroupingTitles.has(normalized)) {
    return null;
  }

  return normalized;
}

function getCompanyPairTitleGroupingKey(title: string) {
  const parts = title.split("<>").map((part) => normalizeEntityValue(part));

  if (parts.length !== 2 || parts.some((part) => !part)) {
    return null;
  }

  return parts.toSorted().join(" <> ");
}

function getExternalMeetingParticipantName(
  attendeeEmails: string[],
  workspaceDomain: string,
) {
  const normalizedWorkspaceDomain = workspaceDomain.trim().toLowerCase();
  let personalEmailName: string | null = null;

  for (const rawEmail of attendeeEmails) {
    const email = normalizeEmailAddress(rawEmail);
    const organizationDomain = getExternalOrganizationDomain(
      email,
      workspaceDomain,
    );

    if (organizationDomain) {
      return formatOrganizationName(organizationDomain);
    }

    const domain = getEmailDomain(email);

    if (!personalEmailName && domain && domain !== normalizedWorkspaceDomain) {
      personalEmailName = formatNameFromEmail(email);
    }
  }

  return personalEmailName;
}

function getWorkspaceOrganizationEntity(workspaceDomain?: string | null) {
  if (!workspaceDomain) {
    return null;
  }

  return normalizeEntityValue(formatOrganizationName(workspaceDomain));
}

function isWorkspaceOrganizationEntity(
  value: string,
  workspaceEntity: string | null,
) {
  return (
    Boolean(workspaceEntity) &&
    normalizeEntityValue(canonicalizeOrganizationName(value)) === workspaceEntity
  );
}

function countSignals(text: string, signals: string[]) {
  return signals.reduce(
    (count, signal) =>
      new RegExp(`\\b${escapeRegExp(signal)}\\b`, "i").test(text)
        ? count + 1
        : count,
    0,
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
