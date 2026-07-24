import { sql } from "drizzle-orm";

export const PUBLIC_WORKSPACE_CREDIT_USD_MICROS = 5_000_000;

export type ProviderCreditStatus = {
  isExhausted: boolean;
  limitUsdMicros: number | null;
  remainingUsdMicros: number | null;
  usedUsdMicros: number;
};

export class ProviderCreditExhaustedError extends Error {
  readonly code = "credit_exhausted";
  readonly limitUsdMicros: number;

  constructor(limitUsdMicros = PUBLIC_WORKSPACE_CREDIT_USD_MICROS) {
    super(
      "Your Tape credit has been used. You can still review existing meetings.",
    );
    this.name = "ProviderCreditExhaustedError";
    this.limitUsdMicros = limitUsdMicros;
  }
}

export async function getWorkspaceProviderCreditStatus(
  teamId: string,
): Promise<ProviderCreditStatus> {
  const { db } = await import("@/db/client");
  const result = await db.execute<{
    credit_limit_usd_micros: number | string | null;
    used_usd_micros: number | string | null;
  }>(sql`
    select
      team.credit_limit_usd_micros,
      coalesce(sum(usage.cost_usd_micros), 0) as used_usd_micros
    from teams team
    left join provider_usage_events usage on usage.team_id = team.id
    where team.id = ${teamId}::uuid
    group by team.id, team.credit_limit_usd_micros
  `);
  const row = result.rows[0];
  const limitUsdMicros =
    row?.credit_limit_usd_micros === null ||
    row?.credit_limit_usd_micros === undefined
      ? null
      : Number(row.credit_limit_usd_micros);
  const usedUsdMicros = Number(row?.used_usd_micros ?? 0);
  const remainingUsdMicros =
    limitUsdMicros === null
      ? null
      : Math.max(0, limitUsdMicros - usedUsdMicros);

  return {
    isExhausted:
      limitUsdMicros !== null && usedUsdMicros >= limitUsdMicros,
    limitUsdMicros,
    remainingUsdMicros,
    usedUsdMicros,
  };
}

export async function assertWorkspaceHasProviderCredit(
  workspace:
    | string
    | {
        creditLimitUsdMicros?: number | null;
        teamId: string;
      },
) {
  if (
    typeof workspace !== "string" &&
    workspace.creditLimitUsdMicros === null
  ) {
    return {
      isExhausted: false,
      limitUsdMicros: null,
      remainingUsdMicros: null,
      usedUsdMicros: 0,
    } satisfies ProviderCreditStatus;
  }

  const status = await getWorkspaceProviderCreditStatus(
    typeof workspace === "string" ? workspace : workspace.teamId,
  );

  if (status.isExhausted && status.limitUsdMicros !== null) {
    throw new ProviderCreditExhaustedError(status.limitUsdMicros);
  }

  return status;
}

export async function assertMeetingHasProviderCredit(meetingId: string) {
  const { db } = await import("@/db/client");
  const result = await db.execute<{ team_id: string }>(sql`
    select team_id
    from meetings
    where id = ${meetingId}::uuid
    limit 1
  `);
  const teamId = result.rows[0]?.team_id;

  return teamId ? assertWorkspaceHasProviderCredit(teamId) : null;
}

export function providerCreditErrorResponse(error: unknown) {
  if (!(error instanceof ProviderCreditExhaustedError)) {
    return null;
  }

  return Response.json(
    {
      code: error.code,
      creditLimitUsdMicros: error.limitUsdMicros,
      error: error.message,
    },
    { status: 402 },
  );
}
