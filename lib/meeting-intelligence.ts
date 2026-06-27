type VocabularyTerm = {
  term: string;
  hint?: string | null;
};

type EntitySegment = {
  id: string;
  text: string;
};

export type MeetingEntityType = "organization" | "product";

export type ExtractedMeetingEntity = {
  segmentId: string;
  type: MeetingEntityType;
  value: string;
  normalizedValue: string;
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
};

const genericMeetingTitles = new Set([
  "google meet",
  "google meet recording",
  "meeting",
  "zoom",
  "zoom meeting",
  "zoom recording",
]);

const knownProductEntities = ["Solana", "TCG"];
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
): ExtractedMeetingEntity[] {
  const entities: ExtractedMeetingEntity[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    for (const value of knownOrganizationEntities) {
      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(segment.text)) {
        addEntity({
          entities,
          seen,
          segmentId: segment.id,
          type: "organization",
          value,
        });
      }
    }

    for (const value of knownProductEntities) {
      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(segment.text)) {
        addEntity({
          entities,
          seen,
          segmentId: segment.id,
          type: "product",
          value,
        });
      }
    }
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

export function groupRelatedMeetings(meetings: MeetingForGrouping[]) {
  const sorted = [...meetings].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const rootByEntity = new Map<string, MeetingForGrouping>();
  const childrenByRoot = new Map<string, MeetingForGrouping[]>();
  const roots: MeetingForGrouping[] = [];

  for (const meeting of sorted) {
    const entity = meeting.primaryEntity?.trim().toLowerCase();

    if (!entity) {
      roots.push(meeting);
      childrenByRoot.set(meeting.id, []);
      continue;
    }

    const existingRoot = rootByEntity.get(entity);

    if (!existingRoot) {
      rootByEntity.set(entity, meeting);
      childrenByRoot.set(meeting.id, []);
      roots.push(meeting);
      continue;
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

function addEntity(input: {
  entities: ExtractedMeetingEntity[];
  seen: Set<string>;
  segmentId: string;
  type: MeetingEntityType;
  value: string;
}) {
  const normalizedValue = normalizeEntityValue(input.value);
  const key = `${input.type}:${normalizedValue}`;

  if (!normalizedValue || input.seen.has(key)) {
    return;
  }

  input.seen.add(key);
  input.entities.push({
    segmentId: input.segmentId,
    type: input.type,
    value: input.value,
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
