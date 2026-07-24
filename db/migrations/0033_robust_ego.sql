CREATE TABLE "provider_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid,
	"meeting_id" uuid,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"cost_usd_micros" bigint NOT NULL,
	"cost_source" text NOT NULL,
	"model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_usage_events_quantity_nonnegative" CHECK ("provider_usage_events"."quantity" >= 0),
	CONSTRAINT "provider_usage_events_cost_nonnegative" CHECK ("provider_usage_events"."cost_usd_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transcript_jobs" ADD COLUMN "billing_keyterms_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage_events" ADD CONSTRAINT "provider_usage_events_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_usage_events_idempotency_unique" ON "provider_usage_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "provider_usage_events_team_occurred_index" ON "provider_usage_events" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "provider_usage_events_user_occurred_index" ON "provider_usage_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "provider_usage_events_meeting_index" ON "provider_usage_events" USING btree ("meeting_id");--> statement-breakpoint
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
	"meetings"."team_id",
	"meetings"."owner_user_id",
	"recordings"."meeting_id",
	'recall',
	'recording',
	'meeting_recording',
	'recall:recording:' || "recordings"."id",
	"recordings"."duration_ms",
	'milliseconds',
	round(("recordings"."duration_ms"::numeric / 3600000) * 500000)::bigint,
	'published_rate',
	jsonb_build_object(
		'meetingTitle', "meetings"."title",
		'pricingDate', '2026-07-23',
		'rateUsdMicrosPerHour', 500000,
		'sourceUrl', 'https://www.recall.ai/pricing'
	),
	"recordings"."created_at",
	now(),
	now()
FROM "recordings"
INNER JOIN "meetings" ON "meetings"."id" = "recordings"."meeting_id"
WHERE "recordings"."source" = 'recall'
	AND "recordings"."duration_ms" > 0
ON CONFLICT ("idempotency_key") DO NOTHING;--> statement-breakpoint
WITH "elevenlabs_usage" AS (
	SELECT
		"transcript_jobs"."id",
		"transcript_jobs"."meeting_id",
		"transcript_jobs"."provider_job_id",
		"transcript_jobs"."created_at",
		COALESCE(
			NULLIF("recordings"."duration_ms", 0),
			"segment_duration"."duration_ms"
		)::integer AS "duration_ms"
	FROM "transcript_jobs"
	LEFT JOIN "recordings" ON "recordings"."id" = "transcript_jobs"."recording_id"
	LEFT JOIN LATERAL (
		SELECT
			greatest(
				coalesce(max(coalesce("transcript_segments"."end_ms", "transcript_segments"."start_ms")), 0)
					- coalesce(min("transcript_segments"."start_ms"), 0),
				0
			)::integer AS "duration_ms"
		FROM "transcript_segments"
		WHERE "transcript_segments"."job_id" = "transcript_jobs"."id"
	) AS "segment_duration" ON true
	WHERE "transcript_jobs"."provider" = 'elevenlabs'
		AND "transcript_jobs"."provider_job_id" IS NOT NULL
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
	"model",
	"metadata",
	"occurred_at",
	"created_at",
	"updated_at"
)
SELECT
	"meetings"."team_id",
	"meetings"."owner_user_id",
	"elevenlabs_usage"."meeting_id",
	'elevenlabs',
	'transcription',
	'speech_to_text',
	'elevenlabs:transcription:' || "elevenlabs_usage"."id",
	"elevenlabs_usage"."duration_ms",
	'milliseconds',
	round(("elevenlabs_usage"."duration_ms"::numeric / 3600000) * 290000)::bigint,
	'published_rate',
	'scribe_v2',
	jsonb_build_object(
		'entityDetection', true,
		'historicalKeytermsUnknown', true,
		'pricingDate', '2026-07-23',
		'providerJobId', "elevenlabs_usage"."provider_job_id",
		'rateUsdMicrosPerHour', 290000,
		'sourceUrl', 'https://elevenlabs.io/pricing/api?price.section=speech_to_text'
	),
	"elevenlabs_usage"."created_at",
	now(),
	now()
FROM "elevenlabs_usage"
INNER JOIN "meetings" ON "meetings"."id" = "elevenlabs_usage"."meeting_id"
WHERE "elevenlabs_usage"."duration_ms" > 0
ON CONFLICT ("idempotency_key") DO NOTHING;
