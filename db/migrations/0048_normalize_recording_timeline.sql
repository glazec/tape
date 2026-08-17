WITH latest_replace AS (
	SELECT DISTINCT ON ("meeting_id")
		"meeting_id",
		"id",
		"created_at"
	FROM "transcript_jobs"
	WHERE "mode" = 'replace'
		AND "status" = 'completed'
	ORDER BY "meeting_id", "created_at" DESC, "id" DESC
), active_recordings AS (
	SELECT
		transcript_jobs."id" AS "job_id",
		transcript_jobs."meeting_id",
		transcript_jobs."mode",
		recordings."started_at",
		recordings."duration_ms",
		row_number() OVER (
			PARTITION BY transcript_jobs."meeting_id"
			ORDER BY transcript_jobs."created_at", transcript_jobs."id"
		) AS "recording_order",
		(
			SELECT MIN(first_recording."started_at")
			FROM "recordings" first_recording
			WHERE first_recording."meeting_id" = transcript_jobs."meeting_id"
				AND first_recording."source" = 'recall'
		) AS "first_started_at"
	FROM "transcript_jobs" transcript_jobs
	INNER JOIN latest_replace
		ON latest_replace."meeting_id" = transcript_jobs."meeting_id"
	INNER JOIN "recordings" recordings
		ON recordings."id" = transcript_jobs."recording_id"
	WHERE transcript_jobs."status" = 'completed'
		AND recordings."source" = 'recall'
		AND (
			transcript_jobs."id" = latest_replace."id"
			OR (
				transcript_jobs."mode" = 'append'
				AND (
					transcript_jobs."created_at" > latest_replace."created_at"
					OR (
						transcript_jobs."created_at" = latest_replace."created_at"
						AND transcript_jobs."id" > latest_replace."id"
					)
				)
			)
		)
), transcript_offsets AS (
	SELECT
		current_recording."job_id",
		GREATEST(
			0,
			EXTRACT(EPOCH FROM (
				current_recording."started_at" - current_recording."first_started_at"
			)) * 1000
		)::integer AS "old_offset_ms",
		COALESCE(SUM(prior_recording."duration_ms"), 0)::integer AS "new_offset_ms"
	FROM active_recordings current_recording
	LEFT JOIN active_recordings prior_recording
		ON prior_recording."meeting_id" = current_recording."meeting_id"
		AND prior_recording."recording_order" < current_recording."recording_order"
	WHERE current_recording."mode" = 'append'
		AND current_recording."started_at" IS NOT NULL
		AND current_recording."first_started_at" IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM active_recordings unknown_duration
			WHERE unknown_duration."meeting_id" = current_recording."meeting_id"
				AND unknown_duration."recording_order" < current_recording."recording_order"
				AND unknown_duration."duration_ms" IS NULL
		)
	GROUP BY
		current_recording."job_id",
		current_recording."started_at",
		current_recording."first_started_at"
)
UPDATE "transcript_segments" transcript_segments
SET
	"start_ms" = GREATEST(
		0,
		transcript_segments."start_ms" - transcript_offsets."old_offset_ms" + transcript_offsets."new_offset_ms"
	),
	"end_ms" = CASE
		WHEN transcript_segments."end_ms" IS NULL THEN NULL
		ELSE GREATEST(
			0,
			transcript_segments."end_ms" - transcript_offsets."old_offset_ms" + transcript_offsets."new_offset_ms"
		)
	END,
	"updated_at" = now()
FROM transcript_offsets
WHERE transcript_segments."job_id" = transcript_offsets."job_id"
	AND transcript_offsets."old_offset_ms" <> transcript_offsets."new_offset_ms";
