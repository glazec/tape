import { ArrowUpRight } from "lucide-react";
import { AppLabel } from "@/components/app-label";
import { LocalDateTime } from "@/components/local-date-time";
import type { PersonTimelineTopic } from "@/lib/person-timeline";

const headings = {
  project: "Ongoing projects",
  focus: "Public topics they follow",
  preference: "Personal preferences",
  trust: "Working together and building trust",
} as const;

export function PersonTimeline({ topics }: { topics: PersonTimelineTopic[] }) {
  if (!topics.length) return null;
  return (
    <div className="mt-8 space-y-8">
      {(Object.keys(headings) as Array<keyof typeof headings>).map(category => {
        const entries = topics.filter(topic => topic.category === category);
        if (!entries.length) return null;
        return (
          <div key={category}>
            <AppLabel as="h3">{headings[category]}</AppLabel>
            <ul className="mt-3 divide-y divide-border">
              {entries.map(topic => <Topic key={topic.id} topic={topic} />)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Topic({ topic }: { topic: PersonTimelineTopic }) {
  const { current, lastConfirmed } = topic;
  const earlier = topic.milestones.filter(event => event.meetingId !== current.meetingId
    || event.segmentId !== current.segmentId || event.summary !== current.summary).reverse();
  const status = current.state === "paused" ? "Paused" : current.state === "completed" ? "Completed" : null;
  return (
    <li className="py-3 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium">{topic.title}</h4>
        {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
      </div>
      <p className="mt-1 text-sm leading-6 text-pretty">{current.summary}</p>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <Source event={current} />
        {lastConfirmed > current.at ? <Source event={topic.lastMention} label="Last mentioned" /> : null}
      </div>
      {earlier.length ? (
        <details className="mt-1">
          <summary className="flex min-h-11 w-fit cursor-pointer items-center text-xs font-medium underline underline-offset-4">
            History · {earlier.length} {earlier.length === 1 ? "update" : "updates"}
          </summary>
          <ul className="space-y-2 border-l border-border pl-3">
            {earlier.map((event, index) => (
              <li key={`${event.meetingId}:${event.segmentId}:${index}`} className="text-sm leading-6">
                <p>{event.summary}</p>
                <Source event={event} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function Source({ event, label = "Source" }: { event: PersonTimelineTopic["current"]; label?: string }) {
  return (
    <a
      className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      href={`/meetings/${event.meetingId}?view=transcript#${event.segmentId}`}
    >
      {label} · <LocalDateTime dateOnly value={event.at} />
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </a>
  );
}
