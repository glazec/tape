ALTER TYPE "public"."meeting_platform" ADD VALUE 'in_person';
--> statement-breakpoint
CREATE TABLE "team_vocabulary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"term" text NOT NULL,
	"hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "location" text;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "description" text;
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "translated_text" text;
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "translation_edited_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "emotion_label" text;
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "emotion_reason" text;
--> statement-breakpoint
CREATE TABLE "meeting_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"segment_id" uuid,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_notification_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_vocabulary_terms" ADD CONSTRAINT "team_vocabulary_terms_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_entities" ADD CONSTRAINT "meeting_entities_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_entities" ADD CONSTRAINT "meeting_entities_segment_id_transcript_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."transcript_segments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD CONSTRAINT "meeting_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "team_vocabulary_terms_team_term_unique" ON "team_vocabulary_terms" USING btree ("team_id","term");
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_entities_meeting_type_value_unique" ON "meeting_entities" USING btree ("meeting_id","type","normalized_value");
--> statement-breakpoint
CREATE INDEX "meeting_entities_normalized_value_index" ON "meeting_entities" USING btree ("normalized_value");
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_reminders_meeting_user_unique" ON "meeting_reminders" USING btree ("meeting_id","user_id");
