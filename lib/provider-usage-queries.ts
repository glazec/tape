import { sql, type SQL } from "drizzle-orm";

import { getWorkspaceProviderCreditStatus } from "@/lib/provider-credit";
import type { WorkspaceContext } from "@/lib/workspace";

export type ProviderUsageBreakdown = {
  category: string;
  costUsdMicros: number;
};

export type RecentProviderUsage = {
  category: string;
  costSource: string;
  costUsdMicros: number;
  historicalEstimate: boolean;
  meetingId: string | null;
  meetingTitle: string | null;
  occurredAt: string;
  provider: string;
};

export type ProviderUsageSummary = {
  breakdown: ProviderUsageBreakdown[];
  creditLimitUsdMicros: number | null;
  creditRemainingUsdMicros: number | null;
  isCreditExhausted: boolean;
  organizationAllTimeUsdMicros: number;
  organizationPeriodUsdMicros: number;
  personalAllTimeUsdMicros: number;
  personalPeriodUsdMicros: number;
  recentPersonalUsage: RecentProviderUsage[];
  trackedSince: string | null;
};

export type ProviderBillingOverview = {
  creditLimitUsdMicros: number | null;
  creditRemainingUsdMicros: number | null;
  isCreditExhausted: boolean;
  organizationMonthUsdMicros: number;
  personalMonthUsdMicros: number;
};

export const providerUsagePeriodOptions = [
  { label: "This month", value: "current_month" },
  { label: "Last month", value: "previous_month" },
  { label: "Last 90 days", value: "last_90_days" },
  { label: "All time", value: "all_time" },
] as const;

export type ProviderUsagePeriod =
  (typeof providerUsagePeriodOptions)[number]["value"];

export const providerUsageCategoryLabels: Record<string, string> = {
  assistant: "Meeting assistant",
  recording: "Meeting recording",
  transcription: "Transcription",
  transcript_polish: "Transcript cleanup",
  translation: "Translation",
};

export async function getProviderUsageSummary(
  workspace: WorkspaceContext,
  period: ProviderUsagePeriod = "current_month",
): Promise<ProviderUsageSummary> {
  const { db } = await import("@/db/client");
  const periodCondition = getProviderUsagePeriodCondition(period);
  const [totalsResult, breakdownResult, recentResult, credit] =
    await Promise.all([
      db.execute<{
        organization_all_time_usd_micros: number | string | null;
        organization_period_usd_micros: number | string | null;
        personal_all_time_usd_micros: number | string | null;
        personal_period_usd_micros: number | string | null;
        tracked_since: Date | string | null;
      }>(sql`
      select
        coalesce(sum(cost_usd_micros), 0) as organization_all_time_usd_micros,
        coalesce(
          sum(cost_usd_micros) filter (
            where ${periodCondition}
          ),
          0
        ) as organization_period_usd_micros,
        coalesce(
          sum(cost_usd_micros) filter (where user_id = ${workspace.userId}::uuid),
          0
        ) as personal_all_time_usd_micros,
        coalesce(
          sum(cost_usd_micros) filter (
            where user_id = ${workspace.userId}::uuid
              and ${periodCondition}
          ),
          0
        ) as personal_period_usd_micros,
        min(occurred_at) as tracked_since
      from provider_usage_events
      where team_id = ${workspace.teamId}::uuid
    `),
      db.execute<{
        category: string;
        cost_usd_micros: number | string;
      }>(sql`
      select category, sum(cost_usd_micros) as cost_usd_micros
      from provider_usage_events
      where team_id = ${workspace.teamId}::uuid
        and ${periodCondition}
      group by category
      order by sum(cost_usd_micros) desc, category
    `),
      db.execute<{
        category: string;
        cost_source: string;
        cost_usd_micros: number | string;
        historical_estimate: boolean;
        meeting_id: string | null;
        meeting_title: string | null;
        occurred_at: Date | string;
        provider: string;
      }>(sql`
      select
        usage.category,
        usage.cost_source,
        usage.cost_usd_micros,
        coalesce(
          (usage.metadata->>'historicalEstimate')::boolean,
          false
        ) as historical_estimate,
        usage.meeting_id,
        coalesce(meeting.title, usage.metadata->>'meetingTitle') as meeting_title,
        usage.occurred_at,
        usage.provider
      from provider_usage_events usage
      left join meetings meeting on meeting.id = usage.meeting_id
      where usage.team_id = ${workspace.teamId}::uuid
        and usage.user_id = ${workspace.userId}::uuid
      order by usage.occurred_at desc, usage.id desc
      limit 20
    `),
      getWorkspaceProviderCreditStatus(workspace.teamId),
    ]);
  const totals = totalsResult.rows[0];

  return {
    breakdown: breakdownResult.rows.map((row) => ({
      category: row.category,
      costUsdMicros: toNumber(row.cost_usd_micros),
    })),
    creditLimitUsdMicros: credit.limitUsdMicros,
    creditRemainingUsdMicros: credit.remainingUsdMicros,
    isCreditExhausted: credit.isExhausted,
    organizationAllTimeUsdMicros: toNumber(
      totals?.organization_all_time_usd_micros,
    ),
    organizationPeriodUsdMicros: toNumber(
      totals?.organization_period_usd_micros,
    ),
    personalAllTimeUsdMicros: toNumber(totals?.personal_all_time_usd_micros),
    personalPeriodUsdMicros: toNumber(totals?.personal_period_usd_micros),
    recentPersonalUsage: recentResult.rows.map((row) => ({
      category: row.category,
      costSource: row.cost_source,
      costUsdMicros: toNumber(row.cost_usd_micros),
      historicalEstimate: row.historical_estimate,
      meetingId: row.meeting_id,
      meetingTitle: row.meeting_title,
      occurredAt: new Date(row.occurred_at).toISOString(),
      provider: row.provider,
    })),
    trackedSince: totals?.tracked_since
      ? new Date(totals.tracked_since).toISOString()
      : null,
  };
}

export async function getProviderBillingOverview(
  workspace: WorkspaceContext,
): Promise<ProviderBillingOverview> {
  const { db } = await import("@/db/client");
  const [usageResult, credit] = await Promise.all([
    db.execute<{
      organization_month_usd_micros: number | string | null;
      personal_month_usd_micros: number | string | null;
    }>(sql`
      select
        coalesce(sum(cost_usd_micros), 0) as organization_month_usd_micros,
        coalesce(
          sum(cost_usd_micros) filter (
            where user_id = ${workspace.userId}::uuid
          ),
          0
        ) as personal_month_usd_micros
      from provider_usage_events
      where team_id = ${workspace.teamId}::uuid
        and occurred_at >= date_trunc('month', now())
    `),
    getWorkspaceProviderCreditStatus(workspace.teamId),
  ]);
  const usage = usageResult.rows[0];

  return {
    creditLimitUsdMicros: credit.limitUsdMicros,
    creditRemainingUsdMicros: credit.remainingUsdMicros,
    isCreditExhausted: credit.isExhausted,
    organizationMonthUsdMicros: toNumber(usage?.organization_month_usd_micros),
    personalMonthUsdMicros: toNumber(usage?.personal_month_usd_micros),
  };
}

export function normalizeProviderUsagePeriod(
  value: string | null | undefined,
): ProviderUsagePeriod {
  return providerUsagePeriodOptions.some((option) => option.value === value)
    ? (value as ProviderUsagePeriod)
    : "current_month";
}

export function getProviderUsagePeriodLabel(
  period: ProviderUsagePeriod,
  now = new Date(),
) {
  if (period === "current_month") {
    return formatMonth(now);
  }

  if (period === "previous_month") {
    return formatMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }

  return period === "last_90_days" ? "Last 90 days" : "All time";
}

export function formatUsdMicros(costUsdMicros: number) {
  const dollars = costUsdMicros / 1_000_000;
  const maximumFractionDigits = dollars > 0 && dollars < 0.01 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(dollars);
}

export function getCreditUsagePercent(input: {
  limitUsdMicros: number | null;
  usedUsdMicros: number;
}) {
  if (input.limitUsdMicros === null || input.limitUsdMicros <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, (input.usedUsdMicros / input.limitUsdMicros) * 100),
  );
}

function getProviderUsagePeriodCondition(period: ProviderUsagePeriod): SQL {
  if (period === "current_month") {
    return sql`occurred_at >= date_trunc('month', now())`;
  }

  if (period === "previous_month") {
    return sql`
      occurred_at >= date_trunc('month', now()) - interval '1 month'
      and occurred_at < date_trunc('month', now())
    `;
  }

  if (period === "last_90_days") {
    return sql`occurred_at >= now() - interval '90 days'`;
  }

  return sql`true`;
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(value);
}

function toNumber(value: number | string | null | undefined) {
  const normalized = Number(value ?? 0);

  return Number.isFinite(normalized) ? normalized : 0;
}
