import type React from "react";
import Link from "next/link";
import { Globe, Mail } from "lucide-react";

import { AppLabel } from "@/components/app-label";
import { LocalDateTime } from "@/components/local-date-time";
import { PersonActivity } from "@/components/person-activity";
import { PersonMeetingList } from "@/components/person-meeting-list";
import { PersonMergeDialog } from "@/components/person-merge-dialog";
import { PersonProfile } from "@/components/person-profile";
import { PersonTodos } from "@/components/person-todos";
import { formatDuration, initials, workDomain } from "@/lib/person-format";
import type { PersonColleague, PersonConnection, PersonFollowupItem, PersonPageData } from "@/lib/people";
import type { StoredPersonProfile } from "@/lib/person-profile";
import { summarizeRelationship } from "@/lib/person-relationship";

/**
 * A person page is shared team knowledge: every colleague sees the same
 * meetings, to dos and profile. Data loading lives in app/people/[personId].
 */
export function PersonPageView({ data, profile, now = new Date() }: { data: PersonPageData; profile: StoredPersonProfile | null; now?: Date }) {
  const { person, meetings, todos, dynamics, connections, colleagues } = data;
  const relationship = summarizeRelationship(meetings, now);
  const next = meetings.filter(meeting => new Date(meeting.at).getTime() > now.getTime()).at(-1);
  const domain = workDomain(person.emails);

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-12 pt-6 pb-16 sm:pt-10">
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {/* Same initials avatar as Intel's people results. */}
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {initials(person.name)}
            </span>
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-[-0.015em]">{person.name}</h1>
          </div>
          {data.canMerge ? <PersonMergeDialog personId={person.id} personName={person.name} /> : null}
        </div>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          {person.emails.map(email => (
            <li className="flex items-center gap-3" key={email}>
              <Mail aria-hidden="true" className="size-4 shrink-0" />
              <a className="min-w-0 truncate hover:text-foreground" href={`mailto:${email}`}>{email}</a>
            </li>
          ))}
          {domain ? (
            <li className="flex items-center gap-3">
              <Globe aria-hidden="true" className="size-4 shrink-0" />
              <a className="min-w-0 truncate hover:text-foreground" href={`https://${domain}`} rel="noreferrer" target="_blank">{domain}</a>
            </li>
          ) : null}
          {person.isTeammate ? <li className="pl-7">Colleague</li> : null}
        </ul>

        {relationship.meetingCount || next ? (
          <div className="mt-8">
            <RelationshipSentence next={next} relationship={relationship} />
            {relationship.meetingCount ? <PersonActivity months={relationship.months} /> : null}
          </div>
        ) : null}
      </header>

      {colleagues.length ? <Colleagues colleagues={colleagues} /> : null}

      {todos.length || dynamics.length ? (
        <section aria-labelledby="person-followup-heading">
          {todos.length ? <PersonTodos items={todos} viewerName={data.viewerName} /> : <h2 className="text-base font-semibold" id="person-followup-heading">To do</h2>}
          {dynamics.length ? <Dynamics items={dynamics} /> : null}
        </section>
      ) : null}

      {person.isTeammate ? null : <PersonProfile initialProfile={profile} personId={person.id} personName={person.name} />}

      {connections.length ? <Connections connections={connections} /> : null}

      <section aria-labelledby="person-meetings-heading">
        <h2 className="text-base font-semibold" id="person-meetings-heading">Meetings</h2>
        {meetings.length ? (
          <PersonMeetingList meetings={meetings} nowIso={now.toISOString()} viewerName={data.viewerName} />
        ) : (
          <p className="mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground text-pretty">No meetings yet.</p>
        )}
        {data.truncated ? <p className="mt-3 text-xs text-muted-foreground">Showing the latest {meetings.length} meetings.</p> : null}
      </section>
    </div>
  );
}

function RelationshipSentence({ relationship, next }: { relationship: ReturnType<typeof summarizeRelationship>; next?: PersonPageData["meetings"][number] }) {
  const count = relationship.meetingCount;
  return (
    <p className="max-w-[52ch] text-base leading-7 text-foreground text-pretty">
      {count ? (
        <>
          {count} {count === 1 ? "meeting" : "meetings"}, {formatDuration(relationship.totalMs)} together.
          {relationship.lastMet ? ` Last met ${relationship.lastMet}` : ""}
        </>
      ) : "No meetings yet"}
      {next ? (
        <>
          {count ? "; next " : ". Next "}
          <LocalDateTime dateOnly value={next.at} />
          {next.canOpen ? <>, <Link className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground" href={`/meetings/${next.id}`}>{next.title}</Link></> : `, ${next.title}`}
        </>
      ) : null}
      {count || next ? "." : ""}
    </p>
  );
}

function Colleagues({ colleagues }: { colleagues: PersonColleague[] }) {
  return (
    <section aria-labelledby="person-colleagues-heading">
      <h2 className="text-base font-semibold" id="person-colleagues-heading">Who meets them</h2>
      <ul className="mt-4 space-y-3">
        {colleagues.slice(0, 6).map(colleague => (
          <li className="flex items-center gap-3" key={colleague.name}>
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {initials(colleague.name)}
            </span>
            <span className="min-w-0 truncate text-sm">{colleague.name}</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {colleague.meetings} {colleague.meetings === 1 ? "meeting" : "meetings"} · {formatDuration(colleague.durationMs)} · <LocalDateTime dateOnly value={colleague.lastAt} />
            </span>
          </li>
        ))}
      </ul>
      {colleagues.length > 6 ? <p className="mt-3 text-xs text-muted-foreground">and {colleagues.length - 6} more colleagues</p> : null}
    </section>
  );
}

function Dynamics({ items }: { items: PersonFollowupItem[] }) {
  return (
    <div className="mt-8">
      <AppLabel as="h3">Offers and needs</AppLabel>
      <ul className="mt-3 space-y-4">
        {items.slice(0, 8).map(item => (
          <li className="min-w-0 text-sm leading-6" key={`${item.meetingId}:${item.todoKey}`}>
            <p className="max-w-[60ch] break-words text-pretty">{item.text}</p>
            <MetaLine item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetaLine({ item, lead }: { item: { meetingId: string; meetingTitle: string; meetingAt: string; segmentId: string }; lead?: string | null }) {
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {lead ? <>{lead} · </> : null}
      <Link className="underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground" href={`/meetings/${item.meetingId}?view=transcript#${item.segmentId}`}>
        {item.meetingTitle}
      </Link>
      {" · "}<LocalDateTime dateOnly value={item.meetingAt} />
    </p>
  );
}

function Connections({ connections }: { connections: PersonConnection[] }) {
  const shown = connections.slice(0, 8);
  return (
    <section aria-labelledby="person-connections-heading">
      <h2 className="text-base font-semibold" id="person-connections-heading">Connections</h2>
      <ul className="mt-4 space-y-6">
        {shown.map((connection, index) => (
          <li className="min-w-0 text-sm leading-6" key={`${connection.meetingId}:${connection.segmentId}:${index}`}>
            <p className="break-words">
              <span className="font-semibold">{connection.name ?? `Unnamed ${connection.kind}`}</span>
              {connection.company && connection.company !== connection.name ? <span className="text-muted-foreground"> · {connection.company}</span> : null}
            </p>
            <p className="max-w-[60ch] break-words text-pretty text-muted-foreground">{connection.context}</p>
            <MetaLine item={connection} lead={connection.relationship} />
          </li>
        ))}
      </ul>
      {connections.length > shown.length ? <p className="mt-3 text-xs text-muted-foreground">and {connections.length - shown.length} more in their meetings</p> : null}
    </section>
  );
}
