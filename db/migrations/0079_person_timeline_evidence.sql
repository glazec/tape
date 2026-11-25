CREATE TABLE "person_timeline_evidence" (
	"person_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	"observations" jsonb NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_timeline_evidence" ADD CONSTRAINT "person_timeline_evidence_person_id_workspace_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_timeline_evidence" ADD CONSTRAINT "person_timeline_evidence_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_timeline_evidence_person_meeting_unique" ON "person_timeline_evidence" USING btree ("person_id","meeting_id");--> statement-breakpoint
CREATE INDEX "person_timeline_evidence_meeting_index" ON "person_timeline_evidence" USING btree ("meeting_id");
--> statement-breakpoint
ALTER TABLE public.person_timeline_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_timeline_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.person_timeline_evidence FROM PUBLIC, tape_authenticated, tape_mcp;
GRANT SELECT, INSERT ON public.person_timeline_evidence TO tape_authenticated;
GRANT UPDATE (source_hash, observations, extracted_at) ON public.person_timeline_evidence TO tape_authenticated;
--> statement-breakpoint
CREATE POLICY person_timeline_source_access ON public.person_timeline_evidence
FOR ALL TO tape_authenticated
USING (
  app_private.can_read_meeting(meeting_id)
  AND EXISTS (
    SELECT 1 FROM public.meetings m
    JOIN public.workspace_people p ON p.team_id = m.team_id
    WHERE m.id = person_timeline_evidence.meeting_id AND p.id = person_timeline_evidence.person_id
      AND p.merged_into_id IS NULL AND app_private.is_internal_member(m.team_id)
  )
);
