CREATE TABLE "intel_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "ai_intel" jsonb;--> statement-breakpoint
ALTER TABLE "intel_searches" ADD CONSTRAINT "intel_searches_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_searches" ADD CONSTRAINT "intel_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intel_searches_owner_index" ON "intel_searches" USING btree ("team_id","user_id","created_at");--> statement-breakpoint
ALTER TABLE public.intel_searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.intel_searches TO tape_authenticated;
--> statement-breakpoint
CREATE POLICY intel_searches_owner ON public.intel_searches FOR ALL TO tape_authenticated
USING (user_id = app_private.current_user_id() AND app_private.can_read_team(team_id))
WITH CHECK (user_id = app_private.current_user_id() AND app_private.can_read_team(team_id));
