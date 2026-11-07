import type { PersonColleague, PersonMeeting } from "@/lib/people";

const DAY = 86_400_000;

export type RelationshipSummary = {
  meetingCount: number;
  spokenCount: number;
  firstAt: string | null;
  lastAt: string | null;
  cadence: string | null;
  lastMet: string | null;
  months: Array<{ key: string; label: string; short: string; count: number; ms: number }>;
  talkShare: number | null;
  totalMs: number;
};

/** Plain facts about how often the team meets this person. */
export function summarizeRelationship(meetings: Array<Pick<PersonMeeting, "at" | "spoke" | "talkMs" | "totalMs"> & { durationMs?: number }>, now = new Date()): RelationshipSummary {
  const past = meetings.filter(meeting => new Date(meeting.at).getTime() <= now.getTime());
  const sorted = [...past].sort((a, b) => a.at.localeCompare(b.at));
  const firstAt = sorted[0]?.at ?? null;
  const lastAt = sorted.at(-1)?.at ?? null;
  let cadence: string | null = null;
  if (sorted.length >= 3) {
    const spanDays = (new Date(lastAt!).getTime() - new Date(firstAt!).getTime()) / DAY;
    cadence = describeInterval(spanDays / (sorted.length - 1));
  }
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const inMonth = past.filter(meeting => meeting.at.slice(0, 7) === key);
    return {
      key,
      label: new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(date),
      short: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date),
      count: inMonth.length,
      ms: inMonth.reduce((sum, meeting) => sum + (meeting.durationMs ?? 0), 0),
    };
  });
  const spoken = past.filter(meeting => meeting.spoke && meeting.totalMs > 0);
  const talkShare = spoken.length
    ? Math.round((spoken.reduce((sum, meeting) => sum + meeting.talkMs, 0) / spoken.reduce((sum, meeting) => sum + meeting.totalMs, 0)) * 100)
    : null;
  return {
    meetingCount: past.length,
    spokenCount: past.filter(meeting => meeting.spoke).length,
    firstAt, lastAt, cadence,
    lastMet: lastAt ? describeAgo((now.getTime() - new Date(lastAt).getTime()) / DAY) : null,
    months, talkShare,
    totalMs: past.reduce((sum, meeting) => sum + (meeting.durationMs ?? 0), 0),
  };
}

export function describeInterval(days: number) {
  if (days < 1.5) return "about daily";
  if (days < 10) return `about every ${Math.round(days)} days`;
  if (days < 45) return `about every ${Math.round(days / 7)} weeks`;
  if (days < 540) return `about every ${Math.round(days / 30)} months`;
  return "about yearly";
}

export function describeAgo(days: number) {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.floor(days)} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export function talkPercent(meeting: Pick<PersonMeeting, "talkMs" | "totalMs">) {
  if (!meeting.totalMs || !meeting.talkMs) return null;
  const percent = Math.round((meeting.talkMs / meeting.totalMs) * 100);
  return percent > 0 ? `${percent}%` : "<1%";
}

/** Which colleagues meet this person, how often, for how long and how recently. */
export function summarizeColleagues(list: PersonMeeting[], now = Date.now()) {
  const byName = new Map<string, PersonColleague>();
  for (const meeting of list) {
    if (new Date(meeting.at).getTime() > now) continue;
    for (const name of meeting.colleagues.length ? meeting.colleagues : [meeting.ownerName]) {
      const entry = byName.get(name) ?? { name, meetings: 0, durationMs: 0, lastAt: meeting.at };
      entry.meetings += 1;
      entry.durationMs += meeting.durationMs;
      if (meeting.at > entry.lastAt) entry.lastAt = meeting.at;
      byName.set(name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => b.meetings - a.meetings || b.durationMs - a.durationMs || a.name.localeCompare(b.name));
}

