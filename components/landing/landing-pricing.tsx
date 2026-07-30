"use client";

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CALENDAR_LOOKBACK_DAYS,
  summarizeConnectedCalendar,
  type CalendarEstimatePayload,
  type ConnectedCalendarSummary,
} from "@/lib/pricing-calendar-estimate";
import {
  CALCULATOR_RATES_SNAPSHOT_DATE,
  comparisonQuotes,
  comparisonTotalUsdMicros,
  computeCostFromHours,
  databaseProviders,
  estimateMonthlyUsage,
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

type UsageAssumptionValues = {
  teamSize: string;
  meetingHoursPerPersonPerWeek: string;
  avgTapeUsersPerMeeting: string;
  recordingCoveragePercent: string;
};

type UsageAssumptionKey = keyof UsageAssumptionValues;

const MANUAL_ASSUMPTIONS: UsageAssumptionValues = {
  teamSize: "10",
  meetingHoursPerPersonPerWeek: "7.5",
  avgTapeUsersPerMeeting: "2",
  recordingCoveragePercent: "100",
};

type CalendarState =
  | { status: "idle" }
  | { status: "ready"; payload: CalendarEstimatePayload }
  | { status: "error"; message: string; retryable?: boolean };

/** What the server produced for a `?calendar=connected` return, if anything. */
export type CalendarEstimateResult =
  | { status: "ready"; payload: CalendarEstimatePayload }
  | { status: "error"; message: string; retryable?: boolean };

function asEditableNumber(value: number, fractionDigits = 1) {
  return String(Number(value.toFixed(fractionDigits)));
}

function calendarAssumptionValues(
  summary: ConnectedCalendarSummary | null,
): UsageAssumptionValues {
  if (!summary) {
    return MANUAL_ASSUMPTIONS;
  }

  return {
    teamSize: String(summary.inferredTeamSize),
    meetingHoursPerPersonPerWeek: asEditableNumber(
      summary.observedMeetingHoursPerWeek,
    ),
    // Google exposes company attendees, not the future Tape user roster.
    avgTapeUsersPerMeeting: "1",
    recordingCoveragePercent: "100",
  };
}

function parseAssumption(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

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
          <Button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            variant={active ? "default" : "ghost"}
            className={cn(
              "h-11 rounded-full border-0 px-4 text-[0.8125rem] leading-5 shadow-none sm:h-8",
              active
                ? "bg-brand-ink text-paper"
                : "text-graphite hover:text-ink",
            )}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function AssumptionField({
  id,
  label,
  value,
  suffix,
  help,
  min,
  max,
  step,
  integer = false,
  onChange,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  suffix: string;
  help: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}) {
  const helpId = `${id}-help`;

  return (
    <div>
      <Label htmlFor={id} className="text-[0.875rem] leading-5 text-ink">
        {label}
      </Label>
      <div className="relative mt-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={(event) => {
            const parsed = Number(event.currentTarget.value);
            const bounded = Number.isFinite(parsed)
              ? Math.min(max, Math.max(min, parsed))
              : min;
            const normalized = String(integer ? Math.round(bounded) : bounded);
            (onCommit ?? onChange)(normalized);
          }}
          className="h-11 border-ink/15 bg-paper pr-20 text-[0.9375rem] text-ink shadow-none tabular-nums focus-visible:border-brand-ink focus-visible:ring-brand/20"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[0.75rem] text-ash">
          {suffix}
        </span>
      </div>
      <p id={helpId} className="mt-2 text-[0.75rem] leading-5 text-ash">
        {help}
      </p>
    </div>
  );
}

function AssumptionFields({
  values,
  calendarSummary,
  onChange,
  onTeamSizeCommit,
}: {
  values: UsageAssumptionValues;
  calendarSummary?: ConnectedCalendarSummary | null;
  onChange: (key: UsageAssumptionKey, value: string) => void;
  onTeamSizeCommit: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="font-mono text-label uppercase tracking-[0.2em] text-graphite">
        Assumptions you can edit
      </legend>
      <div className="mt-4 grid gap-x-5 gap-y-6 sm:grid-cols-2">
        <AssumptionField
          id={
            calendarSummary ? "pricing-calendar-team-size" : "pricing-team-size"
          }
          label="Team members using Tape"
          value={values.teamSize}
          suffix="people"
          min={1}
          max={10000}
          step={1}
          integer
          help={
            calendarSummary
              ? `Prefilled from ${calendarSummary.inferredTeamSize} same domain attendees seen here. Some may not use Tape and colleagues you never meet are missing, so enter the intended user count.`
              : "Count only the people who will use Tape."
          }
          onChange={(value) => onChange("teamSize", value)}
          onCommit={onTeamSizeCommit}
        />
        <AssumptionField
          id={
            calendarSummary ? "pricing-calendar-hours" : "pricing-meeting-hours"
          }
          label="Meeting hours per teammate"
          value={values.meetingHoursPerPersonPerWeek}
          suffix="hrs / wk"
          min={0}
          max={80}
          step={0.25}
          help={
            calendarSummary
              ? `Your primary calendar measured ${calendarSummary.observedMeetingHoursPerWeek.toFixed(1)} hours a week. Edit it if you are not representative.`
              : "Use a typical week, including internal and external calls."
          }
          onChange={(value) => onChange("meetingHoursPerPersonPerWeek", value)}
        />
        <AssumptionField
          id={
            calendarSummary
              ? "pricing-calendar-participants"
              : "pricing-tape-users-per-meeting"
          }
          label="Tape users sharing each meeting"
          value={values.avgTapeUsersPerMeeting}
          suffix="people"
          min={1}
          max={Math.max(1, parseAssumption(values.teamSize))}
          step={0.1}
          help={
            calendarSummary
              ? "Google cannot tell which colleagues will use Tape. Enter how many Tape users typically attend the same recorded call."
              : "Count only Tape users on the same call. Use 1 when their meetings rarely overlap."
          }
          onChange={(value) => onChange("avgTapeUsersPerMeeting", value)}
        />
        <AssumptionField
          id={
            calendarSummary
              ? "pricing-calendar-coverage"
              : "pricing-recording-coverage"
          }
          label="Scheduled meeting time recorded"
          value={values.recordingCoveragePercent}
          suffix="%"
          min={0}
          max={100}
          step={5}
          help="Lower this if Tape will skip private, optional, or unsupported meetings."
          onChange={(value) => onChange("recordingCoveragePercent", value)}
        />
      </div>
    </fieldset>
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
        retryable: true,
      };
    case "unavailable":
      return {
        status: "error",
        message: "Calendar connect is not configured on this deployment.",
        retryable: false,
      };
    default:
      return {
        status: "error",
        message: "That calendar connection did not complete. Try again.",
        retryable: true,
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
  const calendar = useMemo<CalendarState>(
    () => resolveCalendarState(calendarStatus, calendarEstimate),
    [calendarStatus, calendarEstimate],
  );
  const calendarSummary = useMemo(
    () =>
      calendar.status === "ready"
        ? summarizeConnectedCalendar(calendar.payload)
        : null,
    [calendar],
  );
  const [manualAssumptions, setManualAssumptions] =
    useState<UsageAssumptionValues>(MANUAL_ASSUMPTIONS);
  const [calendarAssumptions, setCalendarAssumptions] =
    useState<UsageAssumptionValues>(() =>
      calendarAssumptionValues(calendarSummary),
    );
  const [recordingProviderId, setRecordingProviderId] =
    useState<RecordingProviderId>("attendee");
  const [sttProviderId, setSttProviderId] = useState<SttProviderId>("whisper");
  const [databaseProviderId, setDatabaseProviderId] =
    useState<DatabaseProviderId>("neon");

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

    void fetch("/api/pricing-calendar/forget", { method: "POST" }).catch(() => {
      // The cookie expires on its own within minutes either way.
    });
  }, [calendarStatus]);

  const usingCalendar = mode === "calendar" && calendarSummary !== null;
  const activeAssumptions = usingCalendar
    ? calendarAssumptions
    : manualAssumptions;
  const usage = useMemo(
    () =>
      estimateMonthlyUsage({
        teamSize: parseAssumption(activeAssumptions.teamSize),
        meetingHoursPerPersonPerWeek: parseAssumption(
          activeAssumptions.meetingHoursPerPersonPerWeek,
        ),
        avgTapeUsersPerMeeting: parseAssumption(
          activeAssumptions.avgTapeUsersPerMeeting,
        ),
        recordingCoveragePercent: parseAssumption(
          activeAssumptions.recordingCoveragePercent,
        ),
      }),
    [activeAssumptions],
  );
  const breakdown = useMemo(
    () =>
      computeCostFromHours({
        teamSize: usage.teamSize,
        personMeetingHoursPerMonth: usage.personMeetingHoursPerMonth,
        recordedMeetingHoursPerMonth: usage.recordedMeetingHoursPerMonth,
        recordingProviderId,
        sttProviderId,
        databaseProviderId,
      }),
    [usage, recordingProviderId, sttProviderId, databaseProviderId],
  );

  const effectiveTeamSize = usage.teamSize;

  function updateManualAssumption(key: UsageAssumptionKey, value: string) {
    setManualAssumptions((current) => ({ ...current, [key]: value }));
  }

  function updateCalendarAssumption(key: UsageAssumptionKey, value: string) {
    setCalendarAssumptions((current) => ({ ...current, [key]: value }));
  }

  function commitTeamSize(
    setAssumptions: Dispatch<SetStateAction<UsageAssumptionValues>>,
    value: string,
  ) {
    setAssumptions((current) => {
      const teamSize = parseAssumption(value);
      const sharing = parseAssumption(current.avgTapeUsersPerMeeting);

      return {
        ...current,
        teamSize: value,
        avgTapeUsersPerMeeting:
          sharing > teamSize ? value : current.avgTapeUsersPerMeeting,
      };
    });
  }

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
              Enter what your team expects to record, or connect one calendar to
              prefill the assumptions from a recent sample of up to 90 days.
              Every assumption stays visible and editable.
            </Lede>

            <div className="mt-10">
              <ModeToggle mode={mode} onChange={setMode} />
            </div>

            <div className="mt-10 flex flex-col gap-10">
              {mode === "manual" ? (
                <AssumptionFields
                  values={manualAssumptions}
                  onChange={updateManualAssumption}
                  onTeamSizeCommit={(value) =>
                    commitTeamSize(setManualAssumptions, value)
                  }
                />
              ) : (
                <div>
                  {calendar.status === "ready" && calendarSummary ? (
                    <div className="flex flex-col gap-6">
                      <div className="rounded-lg border border-ink/10 bg-mist/50 p-5">
                        <p className="text-[0.9375rem] font-medium text-ink">
                          What this calendar measured
                        </p>
                        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                          <div>
                            <dt className="text-[0.75rem] uppercase tracking-[0.14em] text-ash">
                              Meeting hours
                            </dt>
                            <dd className="mt-1 tabular-nums text-[1.125rem] text-ink">
                              {calendarSummary.observedMeetingHoursPerWeek.toFixed(
                                1,
                              )}{" "}
                              / week
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[0.75rem] uppercase tracking-[0.14em] text-ash">
                              Meetings
                            </dt>
                            <dd className="mt-1 tabular-nums text-[1.125rem] text-ink">
                              {Math.round(
                                calendarSummary.observedMeetingCountPerMonth,
                              )}{" "}
                              / month
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[0.75rem] uppercase tracking-[0.14em] text-ash">
                              Company people
                            </dt>
                            <dd className="mt-1 tabular-nums text-[1.125rem] text-ink">
                              {calendarSummary.inferredTeamSize} seen
                            </dd>
                          </div>
                        </dl>
                      </div>
                      {calendar.payload.eventLimitReached ? (
                        <Alert className="border-brand-ink/20 bg-brand/5 px-4 py-3">
                          <AlertTitle className="text-[0.8125rem] text-ink">
                            Calendar limit reached
                          </AlertTitle>
                          <AlertDescription className="mt-1 text-[0.75rem] leading-5 text-graphite">
                            Google returned more than 2,000 events. This estimate
                            uses the first 2,000 events and their{" "}
                            {(
                              Math.round(
                                calendar.payload.lookbackDays * 10,
                              ) / 10
                            ).toFixed(1)}{" "}
                            day span.
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      {calendarSummary.qualifyingEventCount === 0 ? (
                        <p className="text-[0.8125rem] leading-5 text-brand-ink">
                          No qualifying meetings were found. Enter the
                          assumptions below to build the estimate manually.
                        </p>
                      ) : null}
                      <AssumptionFields
                        values={calendarAssumptions}
                        calendarSummary={calendarSummary}
                        onChange={updateCalendarAssumption}
                        onTeamSizeCommit={(value) =>
                          commitTeamSize(setCalendarAssumptions, value)
                        }
                      />
                      <p className="text-[0.8125rem] leading-5 text-ash">
                        Only your primary calendar was measured. Google did not
                        expose colleagues&apos; other meetings. We used timed,
                        noncancelled events that you did not decline and ignored
                        focus time, working location, rooms, solo blocks, and
                        events longer than 12 hours.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-ink/10 bg-mist/50 p-6">
                      <p className="text-[0.9375rem] font-medium text-ink">
                        Price your real meetings
                      </p>
                      <p className="mt-2 max-w-[52ch] text-[0.8125rem] leading-5 text-graphite">
                        Connect Google Calendar and we read timed meetings from
                        your primary calendar over the last{" "}
                        {CALENDAR_LOOKBACK_DAYS} days. We use it to prefill the
                        four assumptions, then you can correct anything that is
                        not representative of the team.
                      </p>
                      {calendar.status === "error" ? (
                        <p className="mt-4 text-[0.8125rem] leading-5 text-brand-ink">
                          {calendar.message}
                        </p>
                      ) : null}
                      {calendar.status === "error" &&
                      calendar.retryable === false ? (
                        <Button
                          type="button"
                          onClick={() => setMode("manual")}
                          className="mt-5 h-11 rounded-full bg-brand-ink px-5 text-[0.875rem] text-paper shadow-none hover:bg-brand-ink/90"
                        >
                          Estimate by hand
                        </Button>
                      ) : (
                        <a
                          href="/api/pricing-calendar/start"
                          className="mt-5 inline-flex items-center rounded-full border border-brand-ink bg-brand-ink px-5 py-2.5 text-[0.875rem] font-medium text-paper transition-opacity hover:opacity-90"
                        >
                          {calendar.status === "error"
                            ? "Connect again"
                            : "Connect Google Calendar"}
                        </a>
                      )}
                      <p className="mt-3 text-[0.75rem] leading-5 text-ash">
                        Read only. Colleagues&apos; private calendars are not
                        accessed. Nothing is stored, and this does not create a
                        Tape account or sign you in.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {(mode === "manual" || usingCalendar) && (
                <>
                  <p className="rounded-lg border border-ink/10 bg-mist/50 px-4 py-3 text-[0.8125rem] leading-5 text-graphite">
                    This estimate uses{" "}
                    <strong className="font-medium text-ink tabular-nums">
                      {Math.round(breakdown.personMeetingHoursPerMonth)}
                    </strong>{" "}
                    team meeting hours and{" "}
                    <strong className="font-medium text-ink tabular-nums">
                      {Math.round(breakdown.recordedMeetingHoursPerMonth)}
                    </strong>{" "}
                    distinct recorded hours each month.
                  </p>
                  <div
                    aria-live="polite"
                    className="flex items-end justify-between gap-5 border-y border-ink/10 py-4 lg:hidden"
                  >
                    <div>
                      <p className="font-mono text-label uppercase tracking-[0.2em] text-graphite">
                        Estimated monthly total
                      </p>
                      <p className="mt-1 text-[0.75rem] leading-5 text-ash">
                        {formatUsdMicros(breakdown.perPersonUsdMicros)} per
                        person
                      </p>
                    </div>
                    <p className="font-display text-display-3 text-ink tabular-nums">
                      {formatUsdMicros(breakdown.totalUsdMicros)}
                    </p>
                  </div>
                </>
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
                  ? "Calendar assisted estimate"
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
                      ? ` across ${effectiveTeamSize} people`
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
