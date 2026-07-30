"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Slider } from "@/components/ui/slider";
import {
  CALENDAR_LOOKBACK_DAYS,
  summarizeCalendarUsage,
  type CalendarEstimatePayload,
} from "@/lib/pricing-calendar-estimate";
import {
  CALCULATOR_RATES_SNAPSHOT_DATE,
  comparisonQuotes,
  comparisonTotalUsdMicros,
  computeCostFromHours,
  computeMonthlyCost,
  databaseProviders,
  recordingProviders,
  sttProviders,
  type DatabaseProviderId,
  type RecordingProviderId,
  type SttProviderId,
} from "@/lib/pricing-calculator";
import { cn } from "@/lib/utils";
import {
  Container,
  FadeIn,
  Lede,
  SectionHeading,
  SectionLabel,
} from "./landing-section";

// Same formatting as lib/provider-usage-queries.ts:formatUsdMicros, inlined
// to keep this client section free of the DB-importing queries module.
function formatUsdMicros(costUsdMicros: number) {
  const dollars = costUsdMicros / 1_000_000;
  const maximumFractionDigits = dollars > 0 && dollars < 0.01 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(dollars);
}

type Mode = "manual" | "calendar";

type CalendarState =
  | { status: "idle" }
  | { status: "ready"; payload: CalendarEstimatePayload }
  | { status: "error"; message: string };

/** What the server produced for a `?calendar=connected` return, if anything. */
export type CalendarEstimateResult =
  | { status: "ready"; payload: CalendarEstimatePayload }
  | { status: "error"; message: string };

function PickerGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly {
    id: T;
    label: string;
    rateLabel: string;
    approximate?: boolean;
  }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div>
      <p className="font-mono text-label uppercase tracking-[0.2em] text-graphite">
        {label}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={cn(
                "rounded-full border px-4 py-2 text-left text-[0.8125rem] leading-5 transition-colors",
                active
                  ? "border-brand-ink bg-brand-ink text-paper"
                  : "border-ink/15 bg-paper text-ink hover:border-ink/30",
              )}
            >
              <span className="font-medium">{option.label}</span>
              <span
                className={cn(
                  "ml-2 tabular-nums",
                  active ? "text-paper/70" : "text-ash",
                )}
              >
                {option.approximate ? "~" : ""}
                {option.rateLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={cn(
          "text-[0.9375rem]",
          strong ? "font-medium text-ink" : "text-graphite",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-[0.9375rem] font-medium text-ink" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  const options: readonly { id: Mode; label: string }[] = [
    { id: "manual", label: "Estimate by hand" },
    { id: "calendar", label: "Use my calendar" },
  ];

  return (
    <div className="inline-flex rounded-full border border-ink/15 bg-paper p-1">
      {options.map((option) => {
        const active = option.id === mode;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[0.8125rem] font-medium leading-5 transition-colors",
              active
                ? "bg-brand-ink text-paper"
                : "text-graphite hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function PeoplePicker({
  payload,
  selectedEmails,
  onToggle,
  onSelectAll,
  onSelectNone,
}: {
  payload: CalendarEstimatePayload;
  selectedEmails: readonly string[];
  onToggle: (email: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const selected = new Set(selectedEmails);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-label uppercase tracking-[0.2em] text-graphite">
          Your team at {payload.organizerDomain}
        </p>
        <div className="flex gap-3 text-[0.8125rem]">
          <button
            type="button"
            onClick={onSelectAll}
            className="text-brand-ink hover:underline"
          >
            All
          </button>
          <button
            type="button"
            onClick={onSelectNone}
            className="text-graphite hover:underline"
          >
            None
          </button>
        </div>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-ink/10">
        {payload.people.map((person) => {
          const active = selected.has(person.email);
          return (
            <label
              key={person.email}
              className="flex cursor-pointer items-center gap-3 border-b border-ink/8 px-4 py-2.5 last:border-0 hover:bg-mist/50"
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => onToggle(person.email)}
                className="size-4 shrink-0 accent-brand-ink"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] text-ink">
                  {person.name ?? person.email}
                  {person.isSelf ? (
                    <span className="ml-2 text-[0.75rem] text-ash">you</span>
                  ) : null}
                </span>
                {person.name ? (
                  <span className="block truncate text-[0.75rem] text-ash">
                    {person.email}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-[0.75rem] text-ash">
                {person.meetingCount}{" "}
                {person.meetingCount === 1 ? "meeting" : "meetings"}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Turns the `?calendar=` value the OAuth callback redirects with, plus whatever
 * the server measured, into the first render state. Nothing is fetched in the
 * browser, so there is no loading state to pass through.
 */
function resolveCalendarState(
  status: string | null,
  estimate: CalendarEstimateResult | null,
): CalendarState {
  if (estimate) {
    return estimate;
  }

  switch (status) {
    case null:
    case undefined:
      return { status: "idle" };
    case "denied":
      return {
        status: "error",
        message:
          "Calendar access was declined, so there is nothing to measure.",
      };
    case "unavailable":
      return {
        status: "error",
        message: "Calendar connect is not configured on this deployment.",
      };
    default:
      return {
        status: "error",
        message: "That calendar connection did not complete. Try again.",
      };
  }
}

export function LandingPricing({
  calendarStatus = null,
  calendarEstimate = null,
}: {
  calendarStatus?: string | null;
  calendarEstimate?: CalendarEstimateResult | null;
}) {
  const [mode, setMode] = useState<Mode>(
    calendarStatus ? "calendar" : "manual",
  );
  const [teamSize, setTeamSize] = useState(10);
  const [hoursPerDay, setHoursPerDay] = useState(1.5);
  const [attendeesPerMeeting, setAttendeesPerMeeting] = useState(3);
  const [recordingProviderId, setRecordingProviderId] =
    useState<RecordingProviderId>("attendee");
  const [sttProviderId, setSttProviderId] =
    useState<SttProviderId>("whisper");
  const [databaseProviderId, setDatabaseProviderId] =
    useState<DatabaseProviderId>("neon");
  const calendar = useMemo<CalendarState>(
    () => resolveCalendarState(calendarStatus, calendarEstimate),
    [calendarStatus, calendarEstimate],
  );
  // Everyone sharing the domain counts as the team until told otherwise.
  const [selectedEmails, setSelectedEmails] = useState<readonly string[]>(() =>
    calendarEstimate?.status === "ready"
      ? calendarEstimate.payload.people.map((person) => person.email)
      : [],
  );

  // Clean up after the redirect: strip `?calendar=` so a reload does not look
  // like a fresh connection, and drop the access token now that the estimate is
  // rendered. Both touch external systems only, never component state.
  useEffect(() => {
    if (!calendarStatus) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("calendar");
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}#pricing`,
    );

    void fetch("/api/pricing-calendar/forget", { method: "POST" }).catch(
      () => {
        // The cookie expires on its own within minutes either way.
      },
    );
  }, [calendarStatus]);

  const calendarUsage = useMemo(() => {
    if (calendar.status !== "ready") {
      return null;
    }

    return summarizeCalendarUsage(calendar.payload, selectedEmails);
  }, [calendar, selectedEmails]);

  const usingCalendar = mode === "calendar" && calendarUsage !== null;

  // Both modes price the same way; only the hours differ in where they come from.
  const breakdown = useMemo(() => {
    if (usingCalendar && calendarUsage) {
      return computeCostFromHours({
        teamSize: calendarUsage.selectedTeamSize,
        personMeetingHoursPerMonth: calendarUsage.personMeetingHoursPerMonth,
        recordedMeetingHoursPerMonth:
          calendarUsage.recordedMeetingHoursPerMonth,
        recordingProviderId,
        sttProviderId,
        databaseProviderId,
      });
    }

    return computeMonthlyCost({
      teamSize,
      meetingHoursPerPersonPerDay: hoursPerDay,
      avgAttendeesPerMeeting: attendeesPerMeeting,
      recordingProviderId,
      sttProviderId,
      databaseProviderId,
    });
  }, [
    usingCalendar,
    calendarUsage,
    teamSize,
    hoursPerDay,
    attendeesPerMeeting,
    recordingProviderId,
    sttProviderId,
    databaseProviderId,
  ]);

  const effectiveTeamSize = usingCalendar
    ? (calendarUsage?.selectedTeamSize ?? 0)
    : teamSize;

  const toggleEmail = useCallback((email: string) => {
    setSelectedEmails((current) =>
      current.includes(email)
        ? current.filter((entry) => entry !== email)
        : [...current, email],
    );
  }, []);

  return (
    <section id="pricing" className="border-b border-ink/8 bg-paper">
      <Container className="py-20 lg:py-28">
        <div className="grid gap-x-16 gap-y-12 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <FadeIn>
            <SectionLabel>06 · Pricing</SectionLabel>
            <SectionHeading>
              Pay for compute,
              <br />
              <em className="italic text-graphite">not seats.</em>
            </SectionHeading>
            <Lede>
              Tape runs on infrastructure you choose. Estimate with the sliders,
              or connect your calendar to price the meetings you actually held —
              internal calls counted once, not once per colleague.
            </Lede>

            <div className="mt-10">
              <ModeToggle mode={mode} onChange={setMode} />
            </div>

            <div className="mt-10 flex flex-col gap-10">
              {mode === "manual" ? (
                <>
                  <div>
                    <div className="flex items-baseline justify-between gap-4">
                      <label
                        htmlFor="pricing-team-size"
                        className="text-[0.9375rem] font-medium text-ink"
                      >
                        Team size
                      </label>
                      <span className="tabular-nums text-[0.9375rem] text-graphite">
                        {teamSize} {teamSize === 1 ? "person" : "people"}
                      </span>
                    </div>
                    <Slider
                      id="pricing-team-size"
                      className="mt-3"
                      min={1}
                      max={200}
                      step={1}
                      value={teamSize}
                      onValueChange={(value) => setTeamSize(value)}
                    />
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-4">
                      <label
                        htmlFor="pricing-hours"
                        className="text-[0.9375rem] font-medium text-ink"
                      >
                        Meeting hours per person per day
                      </label>
                      <span className="tabular-nums text-[0.9375rem] text-graphite">
                        {hoursPerDay.toFixed(2)} hrs
                      </span>
                    </div>
                    <Slider
                      id="pricing-hours"
                      className="mt-3"
                      min={0.5}
                      max={6}
                      step={0.25}
                      value={hoursPerDay}
                      onValueChange={(value) => setHoursPerDay(value)}
                    />
                    <p className="mt-2 text-[0.8125rem] leading-5 text-ash">
                      ≈ {Math.round(breakdown.personMeetingHoursPerMonth)} person
                      hours per month across the team.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-4">
                      <label
                        htmlFor="pricing-attendees"
                        className="text-[0.9375rem] font-medium text-ink"
                      >
                        Teammates per internal meeting
                      </label>
                      <span className="tabular-nums text-[0.9375rem] text-graphite">
                        {Math.min(attendeesPerMeeting, teamSize)}{" "}
                        {Math.min(attendeesPerMeeting, teamSize) === 1
                          ? "person"
                          : "people"}
                      </span>
                    </div>
                    <Slider
                      id="pricing-attendees"
                      className="mt-3"
                      min={1}
                      max={12}
                      step={1}
                      value={attendeesPerMeeting}
                      onValueChange={(value) => setAttendeesPerMeeting(value)}
                    />
                    <p className="mt-2 text-[0.8125rem] leading-5 text-ash">
                      An internal call is recorded once, not once per attendee,
                      so Tape processes ≈{" "}
                      {Math.round(breakdown.recordedMeetingHoursPerMonth)}{" "}
                      recorded hours per month.
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  {calendar.status === "ready" ? (
                    <div className="flex flex-col gap-6">
                      <PeoplePicker
                        payload={calendar.payload}
                        selectedEmails={selectedEmails}
                        onToggle={toggleEmail}
                        onSelectAll={() =>
                          setSelectedEmails(
                            calendar.payload.people.map(
                              (person) => person.email,
                            ),
                          )
                        }
                        onSelectNone={() => setSelectedEmails([])}
                      />
                      {calendarUsage ? (
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-ink/10 bg-mist/50 p-4 sm:grid-cols-3">
                          <div>
                            <dt className="text-[0.75rem] uppercase tracking-[0.14em] text-ash">
                              Recorded hrs / mo
                            </dt>
                            <dd className="mt-1 tabular-nums text-[1.125rem] text-ink">
                              {Math.round(
                                calendarUsage.recordedMeetingHoursPerMonth,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[0.75rem] uppercase tracking-[0.14em] text-ash">
                              Person hrs / mo
                            </dt>
                            <dd className="mt-1 tabular-nums text-[1.125rem] text-ink">
                              {Math.round(
                                calendarUsage.personMeetingHoursPerMonth,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[0.75rem] uppercase tracking-[0.14em] text-ash">
                              Meetings / mo
                            </dt>
                            <dd className="mt-1 tabular-nums text-[1.125rem] text-ink">
                              {Math.round(
                                calendarUsage.recordedMeetingCountPerMonth,
                              )}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                      <p className="text-[0.8125rem] leading-5 text-ash">
                        Measured from the last {calendar.payload.lookbackDays}{" "}
                        days ({calendar.payload.scannedEventCount} events
                        scanned). Shared internal calls are counted once, which
                        is why recorded hours sit below person hours.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-ink/10 bg-mist/50 p-6">
                      <p className="text-[0.9375rem] font-medium text-ink">
                        Price your real meetings
                      </p>
                      <p className="mt-2 max-w-[52ch] text-[0.8125rem] leading-5 text-graphite">
                        Connect Google Calendar and we read the last{" "}
                        {CALENDAR_LOOKBACK_DAYS} days to find who you meet with
                        at your own domain. Pick the colleagues who would use
                        Tape and the estimate uses your real meeting hours.
                      </p>
                      {calendar.status === "error" ? (
                        <p className="mt-4 text-[0.8125rem] leading-5 text-brand-ink">
                          {calendar.message}
                        </p>
                      ) : null}
                      <a
                        href="/api/pricing-calendar/start"
                        className="mt-5 inline-flex items-center rounded-full border border-brand-ink bg-brand-ink px-5 py-2.5 text-[0.875rem] font-medium text-paper transition-opacity hover:opacity-90"
                      >
                        {calendar.status === "error"
                          ? "Connect again"
                          : "Connect Google Calendar"}
                      </a>
                      <p className="mt-3 text-[0.75rem] leading-5 text-ash">
                        Read only. Nothing is stored, and this does not create a
                        Tape account or sign you in.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <PickerGroup
                label="Recording"
                options={recordingProviders.map((p) => ({
                  id: p.id,
                  label: p.label,
                  rateLabel:
                    p.rateUsdMicrosPerHour === 0
                      ? `$${Math.round((p.selfHostMonthlyUsdMicros ?? 0) / 1_000_000)}/mo self-host`
                      : `$${(p.rateUsdMicrosPerHour / 1_000_000).toFixed(2)}/hr`,
                }))}
                value={recordingProviderId}
                onChange={setRecordingProviderId}
              />

              <PickerGroup
                label="Speech to text"
                options={sttProviders.map((p) => ({
                  id: p.id,
                  label: p.label,
                  rateLabel:
                    p.rateUsdMicrosPerHour === 0
                      ? "self-host"
                      : `$${(p.rateUsdMicrosPerHour / 1_000_000).toFixed(2)}/hr`,
                  approximate: "approximate" in p && p.approximate,
                }))}
                value={sttProviderId}
                onChange={setSttProviderId}
              />

              <PickerGroup
                label="Database"
                options={databaseProviders.map((p) => ({
                  id: p.id,
                  label: p.label,
                  rateLabel: `$${Math.round(p.monthlyUsdMicros / 1_000_000)}/mo`,
                  approximate: "approximate" in p && p.approximate,
                }))}
                value={databaseProviderId}
                onChange={setDatabaseProviderId}
              />
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="rounded-xl border border-ink/10 bg-mist/70 p-6 sm:p-7 lg:sticky lg:top-24">
              <p className="font-mono text-label uppercase tracking-[0.2em] text-graphite">
                {usingCalendar
                  ? "Monthly, from your calendar"
                  : "Monthly infrastructure"}
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <BreakdownRow
                  label="Recording"
                  value={formatUsdMicros(breakdown.recordingUsdMicros)}
                />
                <BreakdownRow
                  label="Transcription"
                  value={formatUsdMicros(breakdown.sttUsdMicros)}
                />
                <BreakdownRow
                  label="AI summaries"
                  value={formatUsdMicros(breakdown.llmUsdMicros)}
                />
                <BreakdownRow
                  label="Database"
                  value={formatUsdMicros(breakdown.databaseUsdMicros)}
                />
                <BreakdownRow
                  label="Hosting"
                  value={formatUsdMicros(breakdown.hostingUsdMicros)}
                />
              </div>
              <div className="mt-5 border-t border-ink/10 pt-5">
                <BreakdownRow
                  strong
                  label="Total"
                  value={formatUsdMicros(breakdown.totalUsdMicros)}
                />
                <div className="mt-6">
                  <p className="font-display text-display-2 tracking-[-0.02em] text-ink tabular-nums">
                    {formatUsdMicros(breakdown.perPersonUsdMicros)}
                  </p>
                  <p className="mt-1 text-[0.8125rem] leading-5 text-graphite">
                    per person per month, all in
                    {usingCalendar && effectiveTeamSize > 0
                      ? ` across ${effectiveTeamSize} selected`
                      : ""}
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>

        <FadeIn delay={0.15}>
          <div className="mt-16 overflow-hidden rounded-xl border border-ink/10">
            <table className="w-full text-left text-[0.9375rem]">
              <thead>
                <tr className="border-b border-ink/10 bg-mist/70">
                  <th className="px-5 py-3.5 font-medium text-ink">
                    Per-seat tools
                  </th>
                  <th className="px-5 py-3.5 text-right font-medium text-ink">
                    Per seat / mo
                  </th>
                  <th className="px-5 py-3.5 text-right font-medium text-ink">
                    {effectiveTeamSize}{" "}
                    {effectiveTeamSize === 1 ? "seat" : "seats"} / mo
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-ink/8 last:border-0"
                  >
                    <td className="px-5 py-3.5 text-graphite">{quote.label}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink">
                      {formatUsdMicros(quote.perSeatMonthlyUsdMicros)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink">
                      {formatUsdMicros(
                        comparisonTotalUsdMicros(
                          quote.perSeatMonthlyUsdMicros,
                          effectiveTeamSize,
                        ),
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-mist/70">
                  <td className="px-5 py-3.5 font-medium text-ink">
                    Tape (your stack)
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums font-medium text-ink">
                    {formatUsdMicros(breakdown.perPersonUsdMicros)}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums font-medium text-ink">
                    {formatUsdMicros(breakdown.totalUsdMicros)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[64ch] text-[0.8125rem] leading-5 text-ash">
            Estimates from public list prices, snapshot{" "}
            {CALCULATOR_RATES_SNAPSHOT_DATE}. Recording and transcription scale
            with meeting hours; database and hosting are flat monthly.
            Self-hosted capture and transcription share one box, counted once.
            Neon is usage-based, Ali Paraformer is not publicly fixed — both
            shown as approximations. Per-seat quotes are annual-billing list
            rates.
          </p>
        </FadeIn>
      </Container>
    </section>
  );
}
