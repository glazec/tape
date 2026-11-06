CREATE TABLE "meeting_speaker_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_speaker_changes" ADD CONSTRAINT "meeting_speaker_changes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_speaker_changes" ADD CONSTRAINT "meeting_speaker_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "meeting_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"source_bucket_key" text,
	"source_label" text,
	"display_name" text,
	"person_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"email" text NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"preferred_name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "attribution_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "meeting_speaker_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_speakers" ADD CONSTRAINT "meeting_speakers_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_speakers" ADD CONSTRAINT "meeting_speakers_job_id_transcript_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."transcript_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_speakers" ADD CONSTRAINT "meeting_speakers_person_id_workspace_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."workspace_people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_emails" ADD CONSTRAINT "person_emails_person_id_workspace_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_emails" ADD CONSTRAINT "person_emails_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_emails" ADD CONSTRAINT "person_emails_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_people" ADD CONSTRAINT "workspace_people_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_people" ADD CONSTRAINT "workspace_people_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_speakers_source_bucket_unique" ON "meeting_speakers" USING btree ("meeting_id","job_id","source_bucket_key") WHERE "meeting_speakers"."source_bucket_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "person_emails_person_email_unique" ON "person_emails" USING btree ("person_id","email");--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_meeting_speaker_id_meeting_speakers_id_fk" FOREIGN KEY ("meeting_speaker_id") REFERENCES "public"."meeting_speakers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Keep all historical speaker text intact. Labels, including NULL and empty text,
-- are distinct within each transcription job. Corrections never reuse buckets.
INSERT INTO meeting_speakers(meeting_id,job_id,source_bucket_key,source_label,display_name)
SELECT DISTINCT meeting_id,job_id,CASE WHEN speaker IS NULL THEN 'null' ELSE 'text:' || speaker END,speaker,speaker FROM transcript_segments;
UPDATE transcript_segments s SET meeting_speaker_id=g.id FROM meeting_speakers g
WHERE g.meeting_id=s.meeting_id AND g.job_id=s.job_id AND g.source_label IS NOT DISTINCT FROM s.speaker;

CREATE FUNCTION app_private.is_workspace_member(target_team uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.team_memberships WHERE team_id=target_team AND user_id=app_private.current_user_id())
$$;
CREATE FUNCTION app_private.can_manage_speaker(target_meeting uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.meetings m JOIN public.team_memberships tm ON tm.team_id=m.team_id
 WHERE m.id=target_meeting AND tm.user_id=app_private.current_user_id()
 AND (m.owner_user_id=tm.user_id OR tm.role IN ('admin','owner')))
$$;
CREATE FUNCTION app_private.speaker_current_jobs(target_meeting uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH latest_replace AS (SELECT id,created_at,generation_id FROM public.transcript_jobs WHERE meeting_id=target_meeting AND mode='replace' ORDER BY created_at DESC,id DESC LIMIT 1)
 SELECT j.id FROM public.transcript_jobs j WHERE j.meeting_id=target_meeting AND j.status='completed' AND (
 j.id=(SELECT id FROM latest_replace) OR (j.mode='append' AND (
 j.generation_id=(SELECT generation_id FROM latest_replace) OR (j.generation_id IS NULL AND (
 NOT EXISTS(SELECT 1 FROM latest_replace) OR (j.created_at,j.id)>(SELECT created_at,id FROM latest_replace))))))
$$;
CREATE FUNCTION app_private.assign_ingested_speaker() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE bucket text;
BEGIN
 IF NEW.meeting_speaker_id IS NULL THEN
  bucket:=CASE WHEN NEW.speaker IS NULL THEN 'null' ELSE 'text:' || NEW.speaker END;
  INSERT INTO public.meeting_speakers(meeting_id,job_id,source_bucket_key,source_label,display_name)
  VALUES(NEW.meeting_id,NEW.job_id,bucket,NEW.speaker,NEW.speaker)
  ON CONFLICT(meeting_id,job_id,source_bucket_key) WHERE source_bucket_key IS NOT NULL DO NOTHING;
  SELECT id INTO NEW.meeting_speaker_id FROM public.meeting_speakers WHERE meeting_id=NEW.meeting_id AND job_id=NEW.job_id AND source_bucket_key=bucket;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER transcript_segments_assign_speaker BEFORE INSERT ON transcript_segments FOR EACH ROW EXECUTE FUNCTION app_private.assign_ingested_speaker();
CREATE FUNCTION app_private.validate_speaker_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='person_emails' THEN
  IF NEW.email<>lower(btrim(NEW.email)) OR NEW.email NOT LIKE '%_@_%' OR NOT EXISTS(SELECT 1 FROM public.workspace_people p WHERE p.id=NEW.person_id AND p.team_id=NEW.team_id) THEN
   RAISE EXCEPTION 'Invalid person email workspace' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='meeting_speakers' THEN
  IF NOT EXISTS(SELECT 1 FROM public.transcript_jobs j WHERE j.id=NEW.job_id AND j.meeting_id=NEW.meeting_id)
   OR (NEW.person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_people p JOIN public.meetings m ON m.team_id=p.team_id WHERE p.id=NEW.person_id AND m.id=NEW.meeting_id)) THEN
   RAISE EXCEPTION 'Speaker belongs to another workspace or job' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND NEW.meeting_speaker_id IS DISTINCT FROM OLD.meeting_speaker_id AND current_user IN ('tape_authenticated','tape_mcp') THEN
   RAISE EXCEPTION 'Use speaker identity mutation' USING ERRCODE='42501'; END IF;
  IF NEW.meeting_speaker_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.meeting_speakers g WHERE g.id=NEW.meeting_speaker_id AND g.meeting_id=NEW.meeting_id AND g.job_id=NEW.job_id) THEN
   RAISE EXCEPTION 'Segment belongs to another speaker job' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER person_emails_validate BEFORE INSERT OR UPDATE ON person_emails FOR EACH ROW EXECUTE FUNCTION app_private.validate_speaker_identity();
CREATE TRIGGER meeting_speakers_validate BEFORE INSERT OR UPDATE ON meeting_speakers FOR EACH ROW EXECUTE FUNCTION app_private.validate_speaker_identity();
CREATE TRIGGER transcript_segments_validate_speaker BEFORE INSERT OR UPDATE ON transcript_segments FOR EACH ROW EXECUTE FUNCTION app_private.validate_speaker_identity();

ALTER TABLE workspace_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_people FORCE ROW LEVEL SECURITY;
ALTER TABLE person_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_emails FORCE ROW LEVEL SECURITY;
ALTER TABLE meeting_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_speakers FORCE ROW LEVEL SECURITY;
CREATE POLICY people_read ON workspace_people FOR SELECT TO tape_authenticated,tape_mcp USING(app_private.is_workspace_member(team_id));
CREATE POLICY emails_read ON person_emails FOR SELECT TO tape_authenticated,tape_mcp USING(app_private.is_workspace_member(team_id));
CREATE POLICY speaker_read ON meeting_speakers FOR SELECT TO tape_authenticated,tape_mcp USING(app_private.can_read_meeting(meeting_id));
REVOKE INSERT,UPDATE,DELETE ON workspace_people,person_emails,meeting_speakers FROM tape_authenticated,tape_mcp;

-- Shared readers receive only the name of a speaker in an accessible meeting.
CREATE FUNCTION app_private.speaker_display(target_meeting uuid, include_emails boolean DEFAULT false)
RETURNS TABLE(id uuid,"meetingSpeakerId" uuid,"personId" uuid,speaker text,"sourceSpeaker" text,"participantEmail" text,"speakerRevision" integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT s.id,g.id,g.person_id,coalesce(p.preferred_name,g.display_name,s.speaker),s.speaker,
 CASE WHEN include_emails AND app_private.can_manage_speaker(target_meeting) THEN
 (SELECT e.email FROM public.person_emails e WHERE e.person_id=p.id ORDER BY e.confirmed_at,e.id LIMIT 1) ELSE NULL END,g.revision
 FROM public.transcript_segments s JOIN public.meeting_speakers g ON g.id=s.meeting_speaker_id
 LEFT JOIN public.workspace_people p ON p.id=g.person_id
 WHERE s.meeting_id=target_meeting AND (SELECT app_private.can_read_meeting(target_meeting))
$$;
CREATE FUNCTION app_private.speaker_participants(target_meeting uuid)
RETURNS TABLE(name text,email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT DISTINCT participants.name,lower(btrim(participants.email)) FROM (
 SELECT NULL::text name,a.email FROM public.meeting_attendees a WHERE a.meeting_id=target_meeting
 UNION SELECT t.name,t.email FROM public.meeting_participant_timeline t WHERE t.meeting_id=target_meeting
 UNION SELECT NULL,e FROM public.calendar_events c JOIN public.meetings m ON m.calendar_event_id=c.id CROSS JOIN LATERAL jsonb_array_elements_text(c.attendee_emails) e WHERE m.id=target_meeting
 UNION SELECT NULL,s.speaker FROM public.transcript_segments s WHERE s.meeting_id=target_meeting AND s.speaker LIKE '%_@_%'
 ) participants WHERE participants.email IS NOT NULL AND app_private.can_manage_speaker(target_meeting)
$$;
CREATE FUNCTION app_private.speaker_people(target_meeting uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT app_private.can_manage_speaker(target_meeting) THEN RAISE EXCEPTION 'Meeting not found' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('people',coalesce((SELECT jsonb_agg(row_to_json(q) ORDER BY q."inMeeting" DESC,q.name,q.id) FROM (
 SELECT p.id,p.preferred_name name,coalesce((SELECT jsonb_agg(e.email ORDER BY e.email) FROM public.person_emails e WHERE e.person_id=p.id),'[]'::jsonb) emails,
 EXISTS(SELECT 1 FROM public.person_emails e JOIN app_private.speaker_participants(target_meeting) a ON a.email=e.email WHERE e.person_id=p.id)
 OR EXISTS(SELECT 1 FROM public.meeting_speakers g WHERE g.meeting_id=target_meeting AND g.person_id=p.id) "inMeeting"
 FROM public.workspace_people p JOIN public.meetings m ON m.team_id=p.team_id WHERE m.id=target_meeting
 ) q),'[]'::jsonb),'participants',coalesce((SELECT jsonb_agg(row_to_json(a)) FROM app_private.speaker_participants(target_meeting) a),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION app_private.mutate_speaker(target_meeting uuid, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.meetings; anchor public.transcript_segments; old_group public.meeting_speakers; target_group uuid; target_person uuid;
 actor uuid:=app_private.current_user_id(); action text:=coalesce(input->>'linkAction','preserve'); scope text:=coalesce(input->>'applyTo','matching_speaker');
 label text:=btrim(input->>'speaker'); preferred text:=nullif(btrim(input->>'preferredName'),''); selected_email text:=nullif(lower(btrim(input->>'participantEmail')),'');
 group_count integer; changed boolean; previous_segments jsonb; result jsonb; legacy boolean:=NOT(input ? 'linkAction');
BEGIN
 IF NOT app_private.can_manage_speaker(target_meeting) THEN RAISE EXCEPTION 'Meeting not found' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.meetings WHERE id=target_meeting FOR UPDATE;
 IF label IS NULL OR length(label)=0 OR length(label)>80 OR (input ? 'preferredName' AND (preferred IS NULL OR length(preferred)>80)) OR action NOT IN ('preserve','link','create','unlink') OR scope NOT IN ('matching_speaker','segment') THEN
  RAISE EXCEPTION 'Invalid speaker label' USING ERRCODE='22023'; END IF;
 IF input->>'segmentId' IS NOT NULL THEN
  SELECT * INTO anchor FROM public.transcript_segments WHERE id=(input->>'segmentId')::uuid AND meeting_id=target_meeting AND job_id IN (SELECT app_private.speaker_current_jobs(target_meeting)) FOR UPDATE;
 ELSE
  SELECT count(DISTINCT s.meeting_speaker_id) INTO group_count FROM public.transcript_segments s
  WHERE s.meeting_id=target_meeting AND s.job_id IN (SELECT app_private.speaker_current_jobs(target_meeting)) AND s.speaker IS NOT DISTINCT FROM input->>'currentSpeaker';
  IF group_count<>1 OR scope='segment' OR NOT legacy THEN RAISE EXCEPTION 'Refresh transcript before editing this speaker' USING ERRCODE='40001'; END IF;
  SELECT * INTO anchor FROM public.transcript_segments s WHERE s.meeting_id=target_meeting AND s.job_id IN (SELECT app_private.speaker_current_jobs(target_meeting)) AND s.speaker IS NOT DISTINCT FROM input->>'currentSpeaker' LIMIT 1 FOR UPDATE;
 END IF;
 IF anchor.id IS NULL THEN RAISE EXCEPTION 'Refresh transcript before editing this speaker' USING ERRCODE='40001'; END IF;
 SELECT * INTO old_group FROM public.meeting_speakers WHERE id=anchor.meeting_speaker_id FOR UPDATE;
 IF (input->>'meetingSpeakerId' IS NOT NULL AND (input->>'meetingSpeakerId')::uuid<>old_group.id)
 OR (input->>'expectedRevision' IS NOT NULL AND (input->>'expectedRevision')::integer<>old_group.revision)
 OR (NOT legacy AND input->>'expectedRevision' IS NULL) THEN RAISE EXCEPTION 'Refresh transcript before editing this speaker' USING ERRCODE='40001'; END IF;
 target_person:=old_group.person_id;
 IF action='link' THEN
  SELECT id INTO target_person FROM public.workspace_people WHERE id=(input->>'personId')::uuid AND team_id=m.team_id FOR UPDATE;
  IF target_person IS NULL THEN RAISE EXCEPTION 'Select a person from this workspace' USING ERRCODE='22023'; END IF;
 ELSIF action='create' THEN
  INSERT INTO public.workspace_people(team_id,preferred_name,created_by) VALUES(m.team_id,coalesce(preferred,label),actor) RETURNING id INTO target_person;
 ELSIF action='unlink' THEN target_person:=NULL;
 END IF;
 IF selected_email IS NOT NULL THEN
  IF action NOT IN ('create','link') OR NOT EXISTS(SELECT 1 FROM app_private.speaker_participants(target_meeting) a WHERE a.email=selected_email) THEN
   RAISE EXCEPTION 'Choose a participant email and explicitly select or create a person' USING ERRCODE='22023'; END IF;
  INSERT INTO public.person_emails(person_id,team_id,email,confirmed_by) VALUES(target_person,m.team_id,selected_email,actor) ON CONFLICT(person_id,email) DO NOTHING;
 END IF;
 IF preferred IS NOT NULL THEN
  IF target_person IS NULL THEN RAISE EXCEPTION 'Select a linked person before renaming' USING ERRCODE='22023'; END IF;
  UPDATE public.workspace_people SET preferred_name=preferred,updated_at=now() WHERE id=target_person;
 END IF;
 SELECT jsonb_agg(id) INTO previous_segments FROM public.transcript_segments WHERE meeting_speaker_id=old_group.id AND (scope='matching_speaker' OR id=anchor.id);
 target_group:=old_group.id;
 -- A display-only rename is not a change to attribution. Splitting membership or
 -- changing a confirmed person is; the original group's revision changes too.
 changed:=target_person IS DISTINCT FROM old_group.person_id;
 IF scope='segment' AND (changed OR label IS DISTINCT FROM old_group.display_name) THEN
  INSERT INTO public.meeting_speakers(meeting_id,job_id,source_label,display_name,person_id,revision)
  VALUES(target_meeting,anchor.job_id,old_group.source_label,label,target_person,old_group.revision+1) RETURNING id INTO target_group;
  UPDATE public.transcript_segments SET meeting_speaker_id=target_group WHERE id=anchor.id;
  UPDATE public.meeting_speakers SET revision=revision+1,updated_at=now() WHERE id=old_group.id;
  changed:=true;
 ELSE
  UPDATE public.meeting_speakers SET display_name=label,person_id=target_person,revision=revision+1,updated_at=now() WHERE id=target_group;
 END IF;
 IF changed THEN UPDATE public.meetings SET attribution_revision=attribution_revision+1 WHERE id=target_meeting; END IF;
 INSERT INTO public.meeting_speaker_changes(meeting_id,actor_user_id,metadata)
 VALUES(target_meeting,actor,jsonb_build_object('previousMeetingSpeakerId',old_group.id,'meetingSpeakerId',target_group,'previousPersonId',old_group.person_id,'personId',target_person,'segmentIds',previous_segments,'previousDisplayName',old_group.display_name,'previousRevision',old_group.revision));
 SELECT jsonb_build_object('updated',true,'segments',coalesce((SELECT jsonb_agg(row_to_json(d)) FROM app_private.speaker_display(target_meeting,true) d WHERE d."meetingSpeakerId" IN (target_group,old_group.id) OR (preferred IS NOT NULL AND d."personId"=target_person)),'[]'::jsonb),
 'person',(SELECT jsonb_build_object('id',p.id,'name',p.preferred_name,'emails',coalesce((SELECT jsonb_agg(e.email ORDER BY e.email) FROM public.person_emails e WHERE e.person_id=p.id),'[]'::jsonb)) FROM public.workspace_people p WHERE p.id=target_person)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.is_workspace_member(uuid),app_private.can_manage_speaker(uuid),app_private.speaker_current_jobs(uuid),app_private.assign_ingested_speaker(),app_private.validate_speaker_identity(),app_private.speaker_display(uuid,boolean),app_private.speaker_participants(uuid),app_private.speaker_people(uuid),app_private.mutate_speaker(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_workspace_member(uuid),app_private.can_manage_speaker(uuid),app_private.speaker_display(uuid,boolean) TO tape_authenticated,tape_mcp;
GRANT EXECUTE ON FUNCTION app_private.speaker_people(uuid),app_private.mutate_speaker(uuid,jsonb) TO tape_authenticated;

ALTER TABLE meeting_speaker_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_speaker_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY speaker_changes_read ON meeting_speaker_changes FOR SELECT TO tape_authenticated,tape_mcp USING(app_private.can_read_meeting(meeting_id));
REVOKE INSERT,UPDATE,DELETE ON meeting_speaker_changes FROM tape_authenticated,tape_mcp;

-- Scalar name projection for search/statistics: one indexed group lookup,
-- never a scan of every segment in the meeting for each input segment.
CREATE FUNCTION app_private.speaker_name(target_group uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(p.preferred_name,g.display_name,g.source_label)
 FROM public.meeting_speakers g LEFT JOIN public.workspace_people p ON p.id=g.person_id
 WHERE g.id=target_group AND app_private.can_read_meeting(g.meeting_id)
$$;
REVOKE ALL ON FUNCTION app_private.speaker_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.speaker_name(uuid) TO tape_authenticated,tape_mcp;
