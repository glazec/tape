export const meetingLibrarySearchScopes = [
  "all",
  "title",
  "participants",
  "transcript",
] as const;

export const meetingLibraryStatusFilters = [
  "all",
  "scheduled",
  "in_progress",
  "ready",
  "failed",
] as const;

export const meetingLibrarySorts = [
  "smart",
  "time_desc",
  "time_asc",
  "duration_desc",
  "duration_asc",
  "participants_desc",
  "participants_asc",
  "title_asc",
  "title_desc",
] as const;

export type MeetingLibrarySearchScope =
  (typeof meetingLibrarySearchScopes)[number];
export type MeetingLibraryStatusFilter =
  (typeof meetingLibraryStatusFilters)[number];
export type MeetingLibrarySort = (typeof meetingLibrarySorts)[number];

export type MeetingLibraryViewConfig = {
  query: string | null;
  searchScope: MeetingLibrarySearchScope;
  status: MeetingLibraryStatusFilter;
  sort: MeetingLibrarySort;
};

export const defaultMeetingLibraryViewConfig: MeetingLibraryViewConfig = {
  query: null,
  searchScope: "all",
  status: "all",
  sort: "smart",
};

export const meetingLibrarySearchScopeLabels: Record<
  MeetingLibrarySearchScope,
  string
> = {
  all: "Everything",
  title: "Meeting name",
  participants: "Participants",
  transcript: "Transcript",
};

export const meetingLibraryStatusLabels: Record<
  MeetingLibraryStatusFilter,
  string
> = {
  all: "Any status",
  scheduled: "Scheduled",
  in_progress: "In progress",
  ready: "Ready",
  failed: "Failed",
};

export const meetingLibrarySortLabels: Record<MeetingLibrarySort, string> = {
  smart: "Smart order",
  time_desc: "Newest first",
  time_asc: "Oldest first",
  duration_desc: "Longest first",
  duration_asc: "Shortest first",
  participants_desc: "Most participants",
  participants_asc: "Fewest participants",
  title_asc: "Meeting name A to Z",
  title_desc: "Meeting name Z to A",
};

export function parseMeetingLibrarySearchScope(
  value: string | string[] | undefined,
): MeetingLibrarySearchScope {
  return parseEnumValue(value, meetingLibrarySearchScopes, "all");
}

export function parseMeetingLibraryStatusFilter(
  value: string | string[] | undefined,
): MeetingLibraryStatusFilter {
  return parseEnumValue(value, meetingLibraryStatusFilters, "all");
}

export function parseMeetingLibrarySort(
  value: string | string[] | undefined,
): MeetingLibrarySort {
  return parseEnumValue(value, meetingLibrarySorts, "smart");
}

export function normalizeMeetingLibraryQuery(
  value: string | string[] | FormDataEntryValue | null | undefined,
) {
  const stringValue = Array.isArray(value) ? value[0] : value;

  return typeof stringValue === "string"
    ? stringValue.replace(/\s+/g, " ").trim() || null
    : null;
}

export function normalizeMeetingLibraryViewConfig(input: {
  q?: string | string[] | FormDataEntryValue | null;
  scope?: string | string[] | FormDataEntryValue | null;
  status?: string | string[] | FormDataEntryValue | null;
  sort?: string | string[] | FormDataEntryValue | null;
}): MeetingLibraryViewConfig {
  return {
    query: normalizeMeetingLibraryQuery(input.q),
    searchScope: parseMeetingLibrarySearchScope(getStringInput(input.scope)),
    status: parseMeetingLibraryStatusFilter(getStringInput(input.status)),
    sort: parseMeetingLibrarySort(getStringInput(input.sort)),
  };
}

function getStringInput(
  value: string | string[] | FormDataEntryValue | null | undefined,
) {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === "string" ? value : undefined;
}

function parseEnumValue<const T extends readonly string[]>(
  value: string | string[] | undefined,
  allowedValues: T,
  fallback: T[number],
) {
  const stringValue = Array.isArray(value) ? value[0] : value;

  return allowedValues.includes(stringValue ?? "")
    ? (stringValue as T[number])
    : fallback;
}
