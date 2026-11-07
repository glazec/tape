"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { AppLabel } from "@/components/app-label";
import { Button } from "@/components/ui/button";

import { formatDuration } from "@/lib/person-format";
import type { PersonMeeting } from "@/lib/people";
import { cn } from "@/lib/utils";

const PREVIEW = 8;
const subscribe = () => () => {};

/**
 * Every team meeting with the person, grouped under local day headings the
 * way Granola lists notes. "With me" narrows to meetings the viewer was in.
 * Meetings the viewer cannot open still count and show, without a link.
 */
export function PersonMeetingList({ meetings, nowIso, viewerName }: { meetings: PersonMeeting[]; nowIso: string; viewerName: string }) {
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [expanded, setExpanded] = useState(false);
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const mine = meetings.filter(meeting => meeting.colleagues.includes(viewerName) || meeting.ownerName === viewerName);
  const list = filter === "mine" ? mine : meetings;
  const shown = expanded ? list : list.slice(0, PREVIEW);
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: PersonMeeting[] }> = [];
    for (const meeting of shown) {
      const label = (meeting.at > nowIso ? "Upcoming · " : "") + (isClient
        ? new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", ...(new Date(meeting.at).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).format(new Date(meeting.at))
        : meeting.at.slice(0, 10));
      const last = result.at(-1);
      if (last?.label === label) last.items.push(meeting);
      else result.push({ label, items: [meeting] });
    }
    return result;
  }, [shown, isClient, nowIso]);

  return (
    <div>
      {mine.length && mine.length !== meetings.length ? (
        <div aria-label="Filter meetings" className="mt-4 inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-1" role="group">
          {(["all", "mine"] as const).map(value => (
            <button
              aria-pressed={filter === value}
              className={cn("inline-flex h-11 items-center rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:h-8", filter === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              key={value}
              onClick={() => { setFilter(value); setExpanded(false); }}
              type="button"
            >
              {value === "all" ? `All meetings ${meetings.length}` : `With me ${mine.length}`}
            </button>
          ))}
        </div>
      ) : null}
      {groups.map(group => (
        <section className="mt-6" key={group.label}>
          <AppLabel as="h3">{group.label}</AppLabel>
          <ul className="mt-1 -mx-2">
            {group.items.map(meeting => <MeetingRow isClient={isClient} key={meeting.id} meeting={meeting} />)}
          </ul>
        </section>
      ))}
      {list.length > PREVIEW && !expanded ? (
        <Button className="mt-4" onClick={() => setExpanded(true)} size="sm" type="button" variant="outline">
          Show {list.length - PREVIEW} more
        </Button>
      ) : null}
    </div>
  );
}

function MeetingRow({ meeting, isClient }: { meeting: PersonMeeting; isClient: boolean }) {
  const time = isClient ? new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(meeting.at)) : "";
  const share = meeting.totalMs && meeting.talkMs ? Math.max(1, Math.round((meeting.talkMs / meeting.totalMs) * 100)) : null;
  const people = meeting.colleagues.length ? meeting.colleagues : [meeting.ownerName];
  const detail = [people.slice(0, 3).join(", ") + (people.length > 3 ? ` +${people.length - 3}` : ""),
    meeting.durationMs ? formatDuration(meeting.durationMs) : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{meeting.title}</span>
          {!meeting.canOpen ? <Lock aria-label="You can't open this meeting" className="size-3 shrink-0 text-muted-foreground" /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {detail}
          {/* On phones the names and duration matter more than talk share. */}
          {share ? <span className="hidden sm:inline"> · they spoke {share}%</span> : null}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</span>
    </>
  );
  const className = "flex min-h-12 items-center gap-3 rounded-lg px-2 py-2";
  return (
    <li>
      {meeting.canOpen ? (
        <Link className={cn(className, "transition-colors duration-150 ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} href={`/meetings/${meeting.id}`}>
          {body}
        </Link>
      ) : (
        <div className={className} title="Private">{body}</div>
      )}
    </li>
  );
}
