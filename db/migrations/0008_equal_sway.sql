CREATE TABLE "meeting_library_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT 'My view' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"query" text,
	"search_scope" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'all' NOT NULL,
	"sort" text DEFAULT 'smart' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_library_views" ADD CONSTRAINT "meeting_library_views_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_library_views" ADD CONSTRAINT "meeting_library_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_library_views_user_team_default_unique" ON "meeting_library_views" USING btree ("user_id","team_id","is_default");
