import { getExternalOrganizationDomain } from "@/lib/email-domains";

type VocabularyTerm = {
  term: string;
  hint?: string | null;
};

type EntitySegment = {
  id: string;
  text: string;
};

export type MeetingEntityType = "meeting_link" | "organization" | "product";
export type MeetingEntitySource =
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

type EntityExtractionContext = {
  attendeeEmails?: string[];
  meetingUrl?: string | null;
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

const knownProductEntities = ["SAFE", "Solana", "TCG"];
const knownOrganizationEntities = ["IOSG", "Nascent"];
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
  const seen = new Set<string>();
  const keyterms: string[] = [];

  for (const item of terms) {
    const term = item.term.replace(/\s+/g, " ").trim();
    const key = term.toLowerCase();

    if (!term || seen.has(key)) {
      continue;
    }

    seen.add(key);
    keyterms.push(term);
  }

  return keyterms;
}

export function buildSmartMeetingTitle(input: {
  eventTitle: string;
  attendeeEmails: string[];
  workspaceDomain: string;
}) {
  const eventTitle = input.eventTitle.replace(/\s+/g, " ").trim();

  if (eventTitle && !genericMeetingTitles.has(eventTitle.toLowerCase())) {
    return eventTitle;
  }

  const workspaceName = formatOrganizationName(input.workspaceDomain);
  const externalDomain = input.attendeeEmails
    .map((email) => email.split("@")[1]?.trim().toLowerCase())
    .find((domain) => domain && domain !== input.workspaceDomain.toLowerCase());

  if (!externalDomain) {
    return eventTitle || "Meeting";
  }

  return `${workspaceName} <> ${formatOrganizationName(externalDomain)}`;
}

export function extractMeetingEntities(
  segments: EntitySegment[],
  context: EntityExtractionContext = {},
): ExtractedMeetingEntity[] {
  const entities: ExtractedMeetingEntity[] = [];
  const workspaceEntity = getWorkspaceOrganizationEntity(context.workspaceDomain);

  segments.forEach((segment) => {
    for (const value of knownOrganizationEntities) {
      if (isWorkspaceOrganizationEntity(value, workspaceEntity)) {
        continue;
      }

      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(segment.text)) {
        addOrMergeEntity({
          entities,
          segmentId: segment.id,
          source: "transcript",
          type: "organization",
          value,
        });
      }
    }

    for (const value of knownProductEntities) {
      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(segment.text)) {
        addOrMergeEntity({
          entities,
          segmentId: segment.id,
          source: "transcript",
          type: "product",
          value,
        });
      }
    }
  });

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
      aliases: entity.type.toLowerCase() === "organization"
        ? buildOrganizationAliases(entity.value)
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
    const keys = getMeetingGroupingKeys(meeting, options);

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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isSupportedEntityType(type: string) {
  const normalized = type.toLowerCase();

  return normalized === "organization" || normalized === "product";
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

function canonicalizeOrganizationName(value: string) {
  const trimmed = value.trim();
  const known = knownOrganizationEntities.find(
    (entity) =>
      normalizeEntityValue(entity) === normalizeEntityValue(trimmed) ||
      normalizeEntityValue(entity) === normalizeEntityValue(trimmed.split(".")[0] ?? ""),
  );

  if (known) {
    return known;
  }

  return formatOrganizationName(trimmed);
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

function getMeetingGroupingKeys(
  meeting: MeetingForGrouping,
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

function getMeetingTitleGroupingKey(title: string) {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");

  if (!normalized || genericMeetingGroupingTitles.has(normalized)) {
    return null;
  }

  return normalized;
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

function formatOrganizationName(domainOrName: string) {
  const root = domainOrName
    .split("@")
    .pop()
    ?.split(".")[0]
    ?.replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();

  if (!root) {
    return domainOrName;
  }

  if (root.toLowerCase() === "iosg") {
    return "IOSG";
  }

  return root
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
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
