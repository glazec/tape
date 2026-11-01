"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CalendarDays, Plus, ArrowUpRight } from "lucide-react";
import { RecordingFilePreview } from "@/components/recording-file-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inferRecordingFileTime,
  localTimeToIso,
  readRecordingCreationTime,
  timeInZone,
} from "@/lib/recording-file-time";
import { organizationHeaders } from "@/lib/organization-request";
import { titleFromUploadFileName } from "@/lib/upload-titles";
import { cn } from "@/lib/utils";

export type RecordingImportSelection = {
  ready: boolean;
  startedAt?: string;
  meetingId?: string;
  title: string;
  destinationTitle?: string;
};
type Candidate = {
  id: string;
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  unavailableReason: string | null;
};

export function RecordingImportReview({
  file,
  teamId,
  disabled = false,
  onChange,
}: {
  file: File;
  teamId?: string;
  disabled?: boolean;
  onChange: (selection: RecordingImportSelection) => void;
}) {
  const [clue] = useState(() => inferRecordingFileTime(file));
  const [zone, setZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [time, setTime] = useState(clue?.localTime ?? "");
  const [timeEdited, setTimeEdited] = useState(false);
  const [creationTime, setCreationTime] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number>();
  const [destination, setDestination] = useState<string | null>(null);
  const [title, setTitle] = useState(() =>
    clue?.source === "filename"
      ? `Meeting on ${clue.localTime.slice(0, 10)}`
      : titleFromUploadFileName(file.name),
  );
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    meetings: Candidate[];
    hasMore?: boolean;
    error?: string;
  } | null>(null);
  const id = useId();
  const dateResult = useMemo(
    () => (time ? localTimeToIso(time, zone) : {}),
    [time, zone],
  );
  const queryKey = `${dateResult.iso ?? ""}:${durationMs ?? ""}:${teamId ?? ""}:${retry}`;
  const current = result?.key === queryKey ? result : null;
  const meetings = current?.meetings ?? [];
  const candidate = meetings.find((item) => item.id === destination);
  const newMeeting = destination === "new";
  const canSubmit =
    !dateResult.error &&
    (newMeeting ? !!title.trim() : !!candidate && !candidate.unavailableReason);
  const zones = useMemo(
    () => [
      ...new Set([
        zone,
        "UTC",
        ...(typeof Intl.supportedValuesOf === "function"
          ? Intl.supportedValuesOf("timeZone")
          : []),
      ]),
    ],
    [zone],
  );

  useEffect(() => {
    let active = true;
    void readRecordingCreationTime(file).then((value) => {
      if (!active || !value) return;
      setCreationTime(value);
    });
    return () => {
      active = false;
    };
  }, [file]);
  useEffect(() => {
    const controller = new AbortController();
    if (!dateResult.iso) return () => controller.abort();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ startedAt: dateResult.iso! });
        if (durationMs) params.set("durationMs", String(durationMs));
        const response = await fetch(
          `/api/uploads/meeting-candidates?${params}`,
          {
            headers: organizationHeaders(teamId),
            signal: controller.signal,
            cache: "no-store",
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Sign in to see calendar meetings."
              : "Could not load calendar meetings. Retry or create a new meeting.",
          );
        const payload = await response.json();
        if (!Array.isArray(payload.meetings))
          throw new Error(
            "Could not load calendar meetings. Retry or create a new meeting.",
          );
        if (!controller.signal.aborted)
          setResult({
            key: queryKey,
            meetings: payload.meetings,
            hasMore: payload.hasMore,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({
            key: queryKey,
            meetings: [],
            error:
              error instanceof Error && error.message.startsWith("Sign in")
                ? error.message
                : "Could not load calendar meetings. Retry or create a new meeting.",
          });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dateResult.iso, durationMs, teamId, queryKey]);
  useEffect(() => {
    onChange({
      ready: canSubmit,
      startedAt: dateResult.iso,
      title: title.trim(),
      meetingId:
        !newMeeting && candidate && !candidate.unavailableReason
          ? candidate.id
          : undefined,
      destinationTitle: candidate?.title,
    });
  }, [canSubmit, dateResult.iso, title, newMeeting, candidate, onChange]);

  function editTime(value: string) {
    setTime(value);
    setTimeEdited(true);
    setDestination(null);
  }
  function dateLabel(value: string) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: zone.startsWith("UTC") ? "UTC" : zone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(
        new Date(
          zone.startsWith("UTC") ? `${timeInZone(value, zone)}Z` : value,
        ),
      );
    } catch {
      return value;
    }
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6">
      <legend className="sr-only">Review recording before uploading</legend>
      <RecordingFilePreview
        key={`${file.name}:${file.size}:${file.lastModified}`}
        file={file}
        onDuration={setDurationMs}
      />
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-time`}>When did it start?</Label>
            <Input
              id={`${id}-time`}
              type="datetime-local"
              step="1"
              value={time}
              className="min-h-11 min-w-0 bg-background"
              onChange={(event) => editTime(event.target.value)}
              aria-invalid={!!dateResult.error}
              aria-describedby={`${id}-time-help`}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-zone`}>Timezone</Label>
            <Input
              id={`${id}-zone`}
              list={`${id}-zones`}
              value={zone}
              className="min-h-11 bg-background"
              onChange={(event) => {
                setZone(event.target.value);
                setTimeEdited(true);
                setDestination(null);
              }}
            />
            <datalist id={`${id}-zones`}>
              {zones.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
        </div>
        <p
          id={`${id}-time-help`}
          className={cn(
            "text-xs leading-5",
            dateResult.error ? "text-destructive" : "text-muted-foreground",
          )}
          role={dateResult.error ? "alert" : undefined}
        >
          {dateResult.error ??
            (timeEdited
              ? "Calendar suggestions follow this time and timezone."
              : clue?.source === "filename"
                ? `Suggested from filename${clue.assumedYear ? "; year assumed" : ""}. Check the date and timezone.`
                : clue?.source === "modified"
                  ? "Suggested from the file modification date. This may be when it was copied, not recorded."
                  : "Enter a recording time to find nearby calendar meetings. You can create a new meeting without it.")}
        </p>
        {creationTime ? (
          <details className="text-xs text-muted-foreground">
            <summary className="min-h-8 cursor-pointer py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {dateResult.iso &&
              Math.abs(Date.parse(creationTime) - Date.parse(dateResult.iso)) >
                300000
                ? "File creation time differs · review details"
                : "File time details"}
            </summary>
            <p className="py-1 leading-5">
              Embedded creation: {dateLabel(creationTime)}. This may be an
              export or finish time.
            </p>
            <Button
              type="button"
              variant="link"
              className="min-h-9 px-0 text-xs"
              onClick={() => {
                try {
                  editTime(timeInZone(creationTime, zone));
                } catch {
                  /* Timezone validation is shown above. */
                }
              }}
            >
              Use embedded time
            </Button>
          </details>
        ) : null}
      </div>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-medium">
          Where should this recording go?
        </legend>
        <div className="divide-y rounded-xl border bg-background">
          {dateResult.iso && !current ? (
            <p
              role="status"
              className="px-4 py-4 text-sm text-muted-foreground"
            >
              Finding nearby calendar meetings…
            </p>
          ) : null}
          {current?.error ? (
            <div className="px-4 py-3">
              <p role="status" className="text-sm text-muted-foreground">
                {current.error}
              </p>
              <Button
                type="button"
                variant="link"
                className="min-h-11 px-0"
                onClick={() => {
                  setDestination(null);
                  setRetry((value) => value + 1);
                }}
              >
                Retry calendar lookup
              </Button>
            </div>
          ) : null}
          {dateResult.iso && current && !current.error && !meetings.length ? (
            <p
              role="status"
              className="px-4 py-4 text-sm text-muted-foreground"
            >
              No nearby calendar meetings. Check the time or create a new
              meeting.
            </p>
          ) : null}
          {meetings.map((meeting) => (
            <div
              key={meeting.id}
              className={cn(
                "px-4 py-3",
                destination === meeting.id && "bg-primary/5",
              )}
            >
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3",
                  meeting.unavailableReason && "cursor-default",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-destination`}
                  className="mt-1.5 size-4 shrink-0 accent-primary"
                  value={meeting.id}
                  checked={destination === meeting.id}
                  disabled={!!meeting.unavailableReason}
                  onChange={() => setDestination(meeting.id)}
                />
                <CalendarDays
                  className="mt-1.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-sm">
                  <span className="block break-words font-medium">
                    {meeting.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {meeting.startedAt
                      ? dateLabel(meeting.startedAt)
                      : "Time unavailable"}
                    {meeting.endedAt ? ` to ${dateLabel(meeting.endedAt)}` : ""}
                  </span>
                  {meeting.unavailableReason ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {meeting.unavailableReason}
                    </span>
                  ) : null}
                </span>
              </label>
              {meeting.unavailableReason ? (
                <a
                  className="ml-7 inline-flex min-h-9 items-center gap-1 text-xs underline-offset-4 hover:underline"
                  href={`/meetings/${encodeURIComponent(meeting.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${meeting.title}`}
                >
                  Open meeting{" "}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ))}
          <div className={cn("px-4 py-3", newMeeting && "bg-primary/5")}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={`${id}-destination`}
                className="size-4 shrink-0 accent-primary"
                value="new"
                checked={newMeeting}
                onChange={() => setDestination("new")}
              />
              <Plus
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="text-sm font-medium">Create a new meeting</span>
            </label>
            {newMeeting ? (
              <div className="pb-1 pt-2 sm:pl-7">
                <Label htmlFor={`${id}-title`}>Meeting title</Label>
                <Input
                  id={`${id}-title`}
                  placeholder="What was this meeting about?"
                  value={title}
                  maxLength={300}
                  className="mt-2 min-h-11 bg-background"
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </div>
            ) : null}
          </div>
        </div>
        {current?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            Showing the nearest meetings. Adjust the recording time to narrow
            the list.
          </p>
        ) : null}
        {candidate && !candidate.unavailableReason ? (
          <p className="text-xs leading-5 text-muted-foreground">
            This recording will use the selected meeting’s existing sharing
            settings.
          </p>
        ) : null}
      </fieldset>
    </fieldset>
  );
}
