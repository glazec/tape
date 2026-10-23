CREATE TABLE "meeting_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_notes_meeting_user_unique" ON "meeting_notes" USING btree ("meeting_id","user_id");
--> statement-breakpoint
ALTER TABLE "meeting_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_notes" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "meeting_notes" TO tape_authenticated;
REVOKE ALL ON "meeting_notes" FROM tape_mcp;
CREATE POLICY personal_notes ON "meeting_notes" FOR ALL TO tape_authenticated
  USING (user_id = app_private.current_user_id() AND app_private.can_read_meeting(meeting_id))
  WITH CHECK (user_id = app_private.current_user_id() AND app_private.can_read_meeting(meeting_id));
