import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { LocalDateTime } from "@/components/local-date-time";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth-guards";
import {
  formatUsdMicros,
  getCreditUsagePercent,
  getProviderUsagePeriodLabel,
  getProviderUsageSummary,
  normalizeProviderUsagePeriod,
  providerUsageCategoryLabels,
  providerUsagePeriodOptions,
} from "@/lib/provider-usage-queries";
import {
  ELEVENLABS_ENTITY_DETECTION_USD_MICROS_PER_HOUR,
  ELEVENLABS_KEYTERM_PROMPTING_USD_MICROS_PER_HOUR,
  ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR,
  PROVIDER_PRICING_SNAPSHOT_DATE,
  RECALL_RECORDING_USD_MICROS_PER_HOUR,
  providerPricingSources,
} from "@/lib/provider-usage";
import { cn } from "@/lib/utils";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type UsagePageProps = {
  searchParams?: Promise<{ period?: string | string[] }>;
};

export default async function UsagePage({ searchParams }: UsagePageProps = {}) {
  const user = await requireCurrentUser();
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const periodValue = Array.isArray(resolvedSearchParams?.period)
    ? resolvedSearchParams.period[0]
    : resolvedSearchParams?.period;
  const period = normalizeProviderUsagePeriod(periodValue);
  const summary = await getProviderUsageSummary(workspace, period);
  const periodLabel = getProviderUsagePeriodLabel(period);
  const hasCreditLimit = summary.creditLimitUsdMicros !== null;
  const creditUsagePercent = getCreditUsagePercent({
    limitUsdMicros: summary.creditLimitUsdMicros,
    usedUsdMicros: summary.organizationAllTimeUsdMicros,
  });

  return (
    <AppShell
      activeHref="/settings/team"
      canCreateMeetings
      oneSignalExternalId={workspace.userId}
    >
      <section className="flex max-w-5xl flex-col gap-6">
        <header className="max-w-2xl">
          <Link
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/settings/team"
          >
            Team settings
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Billing &amp; credits
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Review available credit and the provider costs created by your
            workspace.
          </p>
        </header>

        <section
          aria-labelledby="credit-balance-heading"
          className="overflow-hidden rounded-xl border bg-card"
        >
          <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <div className="p-5 sm:p-6">
              <p
                className="text-sm font-medium text-muted-foreground"
                id="credit-balance-heading"
              >
                Credit remaining
              </p>
              <p className="mt-2 font-mono text-4xl font-semibold tracking-tight tabular-nums">
                {hasCreditLimit
                  ? formatUsdMicros(summary.creditRemainingUsdMicros ?? 0)
                  : "No limit"}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {hasCreditLimit
                  ? summary.isCreditExhausted
                    ? "New provider work is paused. Existing meetings remain available."
                    : `${formatUsdMicros(summary.organizationAllTimeUsdMicros)} of ${formatUsdMicros(summary.creditLimitUsdMicros ?? 0)} consumed.`
                  : "This workspace does not have a credit limit."}
              </p>
              {hasCreditLimit &&
              summary.creditLimitUsdMicros !== null &&
              summary.creditLimitUsdMicros > 0 ? (
                <div className="mt-5">
                  <div
                    aria-label={`${Math.round(creditUsagePercent)} percent of workspace credit consumed`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={Math.round(creditUsagePercent)}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        summary.isCreditExhausted
                          ? "bg-destructive"
                          : "bg-primary",
                      )}
                      style={{ width: `${creditUsagePercent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between gap-4 text-xs text-muted-foreground">
                    <span>{formatUsdMicros(0)}</span>
                    <span>
                      {formatUsdMicros(summary.creditLimitUsdMicros ?? 0)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <dl className="grid border-t bg-muted/25 sm:grid-cols-2 lg:grid-cols-1 lg:border-t-0 lg:border-l">
              <BillingMetric
                description={periodLabel}
                label="Your consumption"
                value={summary.personalPeriodUsdMicros}
              />
              <BillingMetric
                className="border-t sm:border-t-0 sm:border-l lg:border-t lg:border-l-0"
                description={periodLabel}
                label="Workspace consumption"
                value={summary.organizationPeriodUsdMicros}
              />
            </dl>
          </div>
        </section>

        <nav
          aria-label="Billing period"
          className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border bg-card p-1"
        >
          {providerUsagePeriodOptions.map((option) => {
            const isActive = option.value === period;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  buttonVariants({
                    size: "sm",
                    variant: isActive ? "secondary" : "ghost",
                  }),
                  "min-h-11 shadow-none sm:min-h-9",
                  !isActive && "text-muted-foreground",
                )}
                href={`/usage?period=${option.value}`}
                key={option.value}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b bg-muted/25 py-4">
            <CardTitle>Consumption by service</CardTitle>
            <CardDescription>{periodLabel}</CardDescription>
          </CardHeader>
          <CardContent className="py-1">
            {summary.breakdown.length > 0 ? (
              <ul className="divide-y">
                {summary.breakdown.map((item) => {
                  const share =
                    summary.organizationPeriodUsdMicros > 0
                      ? (item.costUsdMicros /
                          summary.organizationPeriodUsdMicros) *
                        100
                      : 0;

                  return (
                    <li className="py-3" key={item.category}>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm">
                          {providerUsageCategoryLabels[item.category] ??
                            item.category}
                        </span>
                        <span className="font-mono text-sm tabular-nums">
                          {formatUsdMicros(item.costUsdMicros)}
                        </span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground/70"
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-7 text-sm text-muted-foreground">
                No credit consumption recorded for this period.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b bg-muted/25 py-4">
            <CardTitle>Your recent activity</CardTitle>
            <CardDescription>
              Costs from meetings you own. Workspace totals do not reveal other
              members&apos; meetings.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-1">
            {summary.recentPersonalUsage.length > 0 ? (
              <ul className="divide-y">
                {summary.recentPersonalUsage.map((item, index) => (
                  <li
                    className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-6"
                    key={`${item.occurredAt}-${item.provider}-${index}`}
                  >
                    <div className="min-w-0">
                      {item.meetingId ? (
                        <Link
                          className="block truncate text-sm font-medium hover:underline"
                          href={`/meetings/${encodeURIComponent(item.meetingId)}`}
                        >
                          {item.meetingTitle ?? "Meeting"}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium">
                          {item.meetingTitle ?? "Deleted meeting"}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {providerUsageCategoryLabels[item.category] ??
                          item.category}
                        {" · "}
                        <LocalDateTime value={item.occurredAt} />
                        {item.historicalEstimate
                          ? " · Historical estimate"
                          : item.costSource === "provider_reported"
                            ? " · Provider reported"
                            : " · Published rate"}
                      </p>
                    </div>
                    <span className="font-mono text-sm tabular-nums">
                      {formatUsdMicros(item.costUsdMicros)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-7 text-sm text-muted-foreground">
                Your completed provider activity will appear here.
              </p>
            )}
          </CardContent>
        </Card>

        <details className="rounded-lg border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Cost basis and history
          </summary>
          <div className="mt-3 max-w-2xl space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              OpenRouter reports the exact amount charged for each model
              response. Recall and ElevenLabs totals use published usage rates,
              so subscriptions, included usage, taxes, and negotiated discounts
              may make invoices different.
            </p>
            <p>
              Historical estimates reconstruct missing Recall recording usage
              from the longest transcript span saved for each meeting. They are
              estimates because earlier Recall invoice quantities were not
              retained.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <a
                  className="underline underline-offset-4"
                  href={providerPricingSources.recall}
                  rel="noreferrer"
                  target="_blank"
                >
                  Recall
                </a>
                {": "}
                {formatHourlyRate(RECALL_RECORDING_USD_MICROS_PER_HOUR)} of
                recording.
              </li>
              <li>
                <a
                  className="underline underline-offset-4"
                  href={providerPricingSources.elevenlabs}
                  rel="noreferrer"
                  target="_blank"
                >
                  ElevenLabs
                </a>
                {": "}
                {formatHourlyRate(ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR)} for
                Scribe v2, plus{" "}
                {formatHourlyRate(
                  ELEVENLABS_ENTITY_DETECTION_USD_MICROS_PER_HOUR,
                )}{" "}
                for entity detection and{" "}
                {formatHourlyRate(
                  ELEVENLABS_KEYTERM_PROMPTING_USD_MICROS_PER_HOUR,
                )}{" "}
                when vocabulary keyterms are used.
              </li>
              <li>
                <a
                  className="underline underline-offset-4"
                  href={providerPricingSources.openrouter}
                  rel="noreferrer"
                  target="_blank"
                >
                  OpenRouter
                </a>
                : provider reported cost and token usage.
              </li>
            </ul>
            <p>
              Published rates checked{" "}
              <time dateTime={PROVIDER_PRICING_SNAPSHOT_DATE}>
                July 23, 2026
              </time>
              {summary.trackedSince ? (
                <>
                  . Recording and transcription history begins{" "}
                  <LocalDateTime value={summary.trackedSince} />
                </>
              ) : null}
              . Model costs begin with this release because earlier provider
              charges were not retained.
            </p>
          </div>
        </details>
      </section>
    </AppShell>
  );
}

function BillingMetric({
  className,
  description,
  label,
  value,
}: {
  className?: string;
  description: string;
  label: string;
  value: number;
}) {
  return (
    <div className={cn("p-5 sm:p-6", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-2 font-mono text-2xl font-semibold tabular-nums">
        {formatUsdMicros(value)}
      </dd>
      <dd className="mt-1 text-xs text-muted-foreground">{description}</dd>
    </div>
  );
}

function formatHourlyRate(costUsdMicros: number) {
  return `${formatUsdMicros(costUsdMicros)} per hour`;
}
