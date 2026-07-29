"use client";

import { useMemo, useState } from "react";

import { Slider } from "@/components/ui/slider";
import {
  CALCULATOR_RATES_SNAPSHOT_DATE,
  comparisonQuotes,
  comparisonTotalUsdMicros,
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

export function LandingPricing() {
  const [teamSize, setTeamSize] = useState(10);
  const [hoursPerDay, setHoursPerDay] = useState(1.5);
  const [recordingProviderId, setRecordingProviderId] =
    useState<RecordingProviderId>("attendee");
  const [sttProviderId, setSttProviderId] =
    useState<SttProviderId>("elevenlabs");
  const [databaseProviderId, setDatabaseProviderId] =
    useState<DatabaseProviderId>("neon");

  const breakdown = useMemo(
    () =>
      computeMonthlyCost({
        teamSize,
        meetingHoursPerPersonPerDay: hoursPerDay,
        recordingProviderId,
        sttProviderId,
        databaseProviderId,
      }),
    [
      teamSize,
      hoursPerDay,
      recordingProviderId,
      sttProviderId,
      databaseProviderId,
    ],
  );

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
              Tape runs on infrastructure you choose. Move the sliders, pick
              providers, and see the real monthly cost of capture, transcription,
              and summaries — against what per-seat tools charge.
            </Lede>

            <div className="mt-12 flex flex-col gap-10">
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
                  ≈ {Math.round(breakdown.meetingHoursPerMonth)} meeting hours
                  per month across the team.
                </p>
              </div>

              <PickerGroup
                label="Recording"
                options={recordingProviders.map((p) => ({
                  id: p.id,
                  label: p.label,
                  rateLabel: `$${(p.rateUsdMicrosPerHour / 1_000_000).toFixed(2)}/hr`,
                }))}
                value={recordingProviderId}
                onChange={setRecordingProviderId}
              />

              <PickerGroup
                label="Speech to text"
                options={sttProviders.map((p) => ({
                  id: p.id,
                  label: p.label,
                  rateLabel: `$${(p.rateUsdMicrosPerHour / 1_000_000).toFixed(2)}/hr`,
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
                Monthly infrastructure
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
                    {teamSize} {teamSize === 1 ? "seat" : "seats"} / mo
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
                          teamSize,
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
            with meeting hours; database and hosting are flat monthly. Ali
            Paraformer is usage-based and not publicly fixed, shown as an
            approximation. Per-seat quotes are annual-billing list rates.
          </p>
        </FadeIn>
      </Container>
    </section>
  );
}
