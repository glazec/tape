"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { AppLabel } from "@/components/app-label";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PersonProfile as Profile, ProfileGeneration, StoredPersonProfile } from "@/lib/person-profile";

type Status = "idle" | "loading" | "error" | "no_meetings";

const expertiseLabels = {
  technical: "Technical",
  operational: "Operations",
  business: "Business",
  social: "People",
} as const;

/**
 * The AI profile is written the first time anyone opens the page, then only
 * when someone presses Refresh. It is shared by the team and reads every team
 * meeting with the person.
 */
export function PersonProfile({
  initialProfile,
  personId,
  personName,
}: {
  initialProfile: StoredPersonProfile | null;
  personId: string;
  personName: string;
}) {
  const [stored, setStored] = useState(initialProfile);
  const [status, setStatus] = useState<Status>(initialProfile ? "idle" : "loading");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function generate() {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(`/api/people/${encodeURIComponent(personId)}/profile`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as (ProfileGeneration & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? "Could not write the profile. Try again.");
      if (body.status === "no_meetings") {
        setStatus("no_meetings");
        return;
      }
      setStored(body.profile);
      setStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not write the profile. Try again.");
      setStatus("error");
    }
  }

  useEffect(() => {
    if (initialProfile || started.current) return;
    started.current = true;
    void generate();
    // Runs once per page open; Refresh regenerates explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = status === "loading";

  return (
    <section aria-labelledby="person-profile-heading" aria-busy={busy}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-semibold" id="person-profile-heading">Profile</h2>
          <AppLabel as="span">AI</AppLabel>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {stored ? (
            <span className="hidden text-xs text-muted-foreground sm:inline"><LocalDateTime dateOnly value={stored.generatedAt} /></span>
          ) : null}
        {stored || status === "error" ? (
          <Button
            disabled={busy}
            onClick={() => void generate()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {busy ? "Writing" : status === "error" && !stored ? "Try again" : "Refresh"}
          </Button>
        ) : null}
        </div>
      </div>

      {stored ? (
        <div className={busy ? "opacity-60 transition-opacity duration-200" : "transition-opacity duration-200"}>
          <ProfileBody stored={stored} />
        </div>
      ) : status === "loading" ? (
        <ProfileSkeleton name={personName} />
      ) : status === "no_meetings" ? (
        <p className="mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground text-pretty">
          No profile yet.
        </p>
      ) : null}
      {status === "error" && error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">{error.replace(/\s*Try again\.?$/, "")}</p>
      ) : null}
    </section>
  );
}

function ProfileSkeleton({ name }: { name: string }) {
  return (
    <div className="mt-4 space-y-3" role="status">
      <span className="sr-only">Writing a profile of {name} from team meetings</span>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function ProfileBody({ stored }: { stored: StoredPersonProfile }) {
  const { profile } = stored;
  const groups: Array<{ label: string; items: Profile["background"] }> = [
    { label: "What they do", items: profile.role },
    { label: "Recent focus", items: profile.recentFocus },
    { label: "Background", items: profile.background },
    { label: "Achievements", items: profile.achievements },
  ];
  // Areas with no evidence add nothing to read.
  const known = (Object.keys(expertiseLabels) as Array<keyof typeof expertiseLabels>).filter(key => profile.expertise[key].level !== "unclear");
  const titles = new Map(stored.sourceMeetings.map(meeting => [meeting.id, meeting.title]));
  const empty = !profile.headline && groups.every(group => !group.items.length) && !known.length;
  return (
    <div className="mt-3">
      {profile.headline ? <p className="max-w-[60ch] text-base leading-7 text-pretty">{profile.headline}</p> : null}
      {empty ? (
        <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground text-pretty">
          Not enough to go on yet.
        </p>
      ) : null}
      <div className="mt-8 space-y-8">
        {groups.filter(group => group.items.length).map(group => (
          <div key={group.label}>
            <AppLabel as="h3">{group.label}</AppLabel>
            <ul className="mt-3 space-y-3">
              {group.items.map((item, index) => (
                <li className="text-sm leading-6 text-pretty" key={index}>
                  {item.text} <Sources ids={item.sources} profile={profile} titles={titles} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {known.length ? <div className="mt-8">
        <AppLabel as="h3">Expertise</AppLabel>
        <dl className="mt-3 space-y-4">
          {known.map(key => {
            const skill = profile.expertise[key];
            return (
              <div key={key}>
                <dt className="flex items-baseline gap-2 text-sm font-semibold">
                  {expertiseLabels[key]}
                  {skill.level === "strong" ? <span className="text-xs font-normal text-muted-foreground">Strong</span> : null}
                </dt>
                <dd className="mt-1 text-sm leading-6 text-muted-foreground text-pretty">
                  {skill.summary} <Sources ids={skill.sources} profile={profile} titles={titles} />
                </dd>
              </div>
            );
          })}
        </dl>
      </div> : null}

    </div>
  );
}

function Sources({ ids, profile, titles }: { ids: string[]; profile: Profile; titles: Map<string, string> }) {
  if (!ids.length) return null;
  return (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      {ids.map((id, index) => {
        const source = profile.sources[id];
        if (!source) return null;
        const seconds = Math.floor(source.startMs / 1000);
        const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        return (
          <a
            aria-label={`Source: ${titles.get(source.meetingId) ?? "meeting"} at ${timestamp}`}
            className="-my-3 inline-flex min-h-11 items-center px-1 tabular-nums underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground sm:my-0 sm:min-h-0"
            title={titles.get(source.meetingId)}
            href={`/meetings/${source.meetingId}?view=transcript#${id}`}
            key={`${id}-${index}`}
          >
            {timestamp}
          </a>
        );
      })}
    </span>
  );
}
