CREATE TABLE "person_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_notes_body_length_check" CHECK (char_length(btrim("person_notes"."body")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_person_id_workspace_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_notes_team_person_created_index" ON "person_notes" USING btree ("team_id","person_id","created_at");
--> statement-breakpoint
ALTER TABLE public.person_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.person_notes FROM PUBLIC, tape_authenticated, tape_mcp;
GRANT SELECT, INSERT, DELETE ON public.person_notes TO tape_authenticated;
GRANT UPDATE (body, updated_at) ON public.person_notes TO tape_authenticated;
--> statement-breakpoint
CREATE POLICY person_notes_read ON public.person_notes FOR SELECT TO tape_authenticated
USING (app_private.is_internal_member(team_id));
CREATE POLICY person_notes_insert ON public.person_notes FOR INSERT TO tape_authenticated
WITH CHECK (app_private.is_internal_member(team_id)
  AND author_id = app_private.current_user_id()
  AND EXISTS (
    SELECT 1 FROM public.workspace_people p
    WHERE p.id = person_notes.person_id AND p.team_id = person_notes.team_id AND p.merged_into_id IS NULL
  ));
CREATE POLICY person_notes_update ON public.person_notes FOR UPDATE TO tape_authenticated
USING (app_private.is_internal_member(team_id) AND author_id = app_private.current_user_id())
WITH CHECK (app_private.is_internal_member(team_id) AND author_id = app_private.current_user_id());
CREATE POLICY person_notes_delete ON public.person_notes FOR DELETE TO tape_authenticated
USING (app_private.is_internal_member(team_id) AND author_id = app_private.current_user_id());
