import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

export const requestRateLimitPolicies = {
  adminImpersonation: {
    limit: 30,
    scope: "admin_impersonation",
    windowMs: 60 * 60 * 1_000,
  },
  dashboardSummaryRefresh: {
    limit: 6,
    scope: "dashboard_summary_refresh",
    windowMs: 60 * 1_000,
  },
  localRecorderProviderUpload: {
    limit: 30,
    scope: "local_recorder_provider_upload",
    windowMs: 60 * 60 * 1_000,
  },
  recoveryTranscriptUpload: {
    limit: 20,
    scope: "recovery_transcript_upload",
    windowMs: 60 * 60 * 1_000,
  },
  serverMediaUpload: {
    limit: 30,
    scope: "server_media_upload",
    windowMs: 60 * 60 * 1_000,
  },
  serverMediaBatchStage: {
    limit: 10,
    scope: "server_media_batch_stage",
    windowMs: 60 * 60 * 1_000,
  },
} as const;

export class RequestRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please try again later.");
    this.name = "RequestRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function assertRequestRateLimit(input: {
  cost?: number;
  limit: number;
  now?: Date;
  scope: string;
  subject: string;
  windowMs: number;
}) {
  const cost = input.cost ?? 1;
  const now = input.now ?? new Date();
  const windowStartedAt = new Date(
    Math.floor(now.getTime() / input.windowMs) * input.windowMs,
  );
  const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs);
  const subjectHash = createHash("sha256")
    .update(input.subject)
    .digest("base64url");
  const { privilegedDb } = await import("@/db/client");
  const result = await privilegedDb.execute<{
    request_count: number | string;
  }>(sql`
    insert into request_rate_limits (
      scope,
      subject_hash,
      window_started_at,
      request_count,
      expires_at,
      created_at,
      updated_at
    )
    values (
      ${input.scope},
      ${subjectHash},
      ${windowStartedAt},
      ${cost},
      ${expiresAt},
      now(),
      now()
    )
    on conflict (scope, subject_hash) do update
    set
      window_started_at = excluded.window_started_at,
      request_count = case
        when request_rate_limits.window_started_at = excluded.window_started_at
          then request_rate_limits.request_count + ${cost}
        else ${cost}
      end,
      expires_at = excluded.expires_at,
      updated_at = now()
    returning request_count
  `);
  const requestCount = Number(result.rows[0]?.request_count ?? 1);

  if (requestCount > input.limit) {
    throw new RequestRateLimitError(
      Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)),
    );
  }

  return {
    limit: input.limit,
    remaining: Math.max(0, input.limit - requestCount),
    resetAt: expiresAt,
  };
}

export function requestRateLimitErrorResponse(error: unknown) {
  if (!(error instanceof RequestRateLimitError)) {
    return null;
  }

  return Response.json(
    { error: error.message },
    {
      headers: {
        "Retry-After": String(error.retryAfterSeconds),
      },
      status: 429,
    },
  );
}
