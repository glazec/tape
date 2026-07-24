CREATE TABLE "request_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_rate_limits_count_positive" CHECK ("request_rate_limits"."request_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "request_rate_limits_scope_subject_unique" ON "request_rate_limits" USING btree ("scope","subject_hash");--> statement-breakpoint
CREATE INDEX "request_rate_limits_expires_index" ON "request_rate_limits" USING btree ("expires_at");