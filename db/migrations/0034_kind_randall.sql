ALTER TABLE "teams" ADD COLUMN "credit_limit_usd_micros" bigint;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_credit_limit_nonnegative" CHECK ("teams"."credit_limit_usd_micros" is null or "teams"."credit_limit_usd_micros" >= 0);--> statement-breakpoint
UPDATE "teams"
SET
	"credit_limit_usd_micros" = NULL,
	"updated_at" = now()
WHERE EXISTS (
	SELECT 1
	FROM "allowed_domains"
	WHERE "allowed_domains"."team_id" = "teams"."id"
		AND "allowed_domains"."domain" = 'iosg.vc'
);--> statement-breakpoint
UPDATE "teams"
SET
	"credit_limit_usd_micros" = 5000000,
	"name" = regexp_replace("name", ' guest workspace$', ' workspace'),
	"updated_at" = now()
WHERE EXISTS (
	SELECT 1
	FROM "team_memberships"
	WHERE "team_memberships"."team_id" = "teams"."id"
		AND "team_memberships"."role" = 'external'
)
AND NOT EXISTS (
	SELECT 1
	FROM "allowed_domains"
	WHERE "allowed_domains"."team_id" = "teams"."id"
);--> statement-breakpoint
UPDATE "team_memberships"
SET
	"role" = 'owner',
	"updated_at" = now()
WHERE "role" = 'external'
	AND EXISTS (
		SELECT 1
		FROM "teams"
		WHERE "teams"."id" = "team_memberships"."team_id"
			AND "teams"."credit_limit_usd_micros" = 5000000
	)
	AND NOT EXISTS (
		SELECT 1
		FROM "allowed_domains"
		WHERE "allowed_domains"."team_id" = "team_memberships"."team_id"
	);--> statement-breakpoint
WITH "legacy_recall_usage" AS (
	SELECT
		"meetings"."id" AS "meeting_id",
		"meetings"."team_id",
		"meetings"."owner_user_id",
		"meetings"."title",
		"meeting_duration"."duration_ms",
		coalesce("meetings"."started_at", "meetings"."created_at") AS "occurred_at"
	FROM "meetings"
	INNER JOIN LATERAL (
		SELECT
			greatest(
				coalesce(max(coalesce("transcript_segments"."end_ms", "transcript_segments"."start_ms")), 0)
					- coalesce(min("transcript_segments"."start_ms"), 0),
				0
			)::integer AS "duration_ms"
		FROM "transcript_jobs"
		INNER JOIN "transcript_segments"
			ON "transcript_segments"."job_id" = "transcript_jobs"."id"
		WHERE "transcript_jobs"."meeting_id" = "meetings"."id"
		GROUP BY "transcript_jobs"."id"
		ORDER BY "duration_ms" DESC
		LIMIT 1
	) AS "meeting_duration" ON true
	WHERE "meetings"."recall_recording_id" IS NOT NULL
		AND "meeting_duration"."duration_ms" > 0
		AND NOT EXISTS (
			SELECT 1
			FROM "provider_usage_events"
			WHERE "provider_usage_events"."meeting_id" = "meetings"."id"
				AND "provider_usage_events"."provider" = 'recall'
		)
)
INSERT INTO "provider_usage_events" (
	"team_id",
	"user_id",
	"meeting_id",
	"provider",
	"category",
	"operation",
	"idempotency_key",
	"quantity",
	"unit",
	"cost_usd_micros",
	"cost_source",
	"metadata",
	"occurred_at",
	"created_at",
	"updated_at"
)
SELECT
	"legacy_recall_usage"."team_id",
	"legacy_recall_usage"."owner_user_id",
	"legacy_recall_usage"."meeting_id",
	'recall',
	'recording',
	'meeting_recording',
	'recall:legacy-meeting:' || "legacy_recall_usage"."meeting_id",
	"legacy_recall_usage"."duration_ms",
	'milliseconds',
	round(("legacy_recall_usage"."duration_ms"::numeric / 3600000) * 500000)::bigint,
	'published_rate',
	jsonb_build_object(
		'durationSource', 'longest_transcript_job',
		'historicalEstimate', true,
		'meetingTitle', "legacy_recall_usage"."title",
		'pricingDate', '2026-07-23',
		'rateUsdMicrosPerHour', 500000,
		'sourceUrl', 'https://www.recall.ai/pricing'
	),
	"legacy_recall_usage"."occurred_at",
	now(),
	now()
FROM "legacy_recall_usage"
ON CONFLICT ("idempotency_key") DO NOTHING;
