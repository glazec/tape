CREATE TABLE "followup_todo_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"todo_key" text NOT NULL,
	"status" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followup_todo_states_status_check" CHECK ("followup_todo_states"."status" in ('todo', 'in_progress', 'done'))
);
--> statement-breakpoint
CREATE TABLE "person_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"target_person_id" uuid NOT NULL,
	"source_person_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"generated_by" uuid,
	"profile" jsonb NOT NULL,
	"source_meeting_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_people" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "followup_todo_states" ADD CONSTRAINT "followup_todo_states_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_todo_states" ADD CONSTRAINT "followup_todo_states_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_todo_states" ADD CONSTRAINT "followup_todo_states_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_target_person_id_workspace_people_id_fk" FOREIGN KEY ("target_person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_source_person_id_workspace_people_id_fk" FOREIGN KEY ("source_person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_names" ADD CONSTRAINT "person_names_person_id_workspace_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_names" ADD CONSTRAINT "person_names_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_person_id_workspace_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."workspace_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followup_todo_states_meeting_key_unique" ON "followup_todo_states" USING btree ("meeting_id","todo_key");--> statement-breakpoint
CREATE UNIQUE INDEX "person_names_person_name_key_unique" ON "person_names" USING btree ("person_id","name_key");--> statement-breakpoint
CREATE INDEX "person_names_team_name_key_index" ON "person_names" USING btree ("team_id","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "person_profiles_person_unique" ON "person_profiles" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "workspace_people" ADD CONSTRAINT "workspace_people_merged_into_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."workspace_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_speakers_person_index" ON "meeting_speakers" USING btree ("person_id") WHERE "meeting_speakers"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "person_emails_team_email_index" ON "person_emails" USING btree ("team_id","email");--> statement-breakpoint
CREATE INDEX "workspace_people_team_index" ON "workspace_people" USING btree ("team_id");
--> statement-breakpoint
-- Comparable form of a person's name. NULL for labels that never identify a
-- person: blanks, generic diarization labels and email addresses (emails are
-- matched through person_emails instead).
CREATE FUNCTION app_private.person_name_key(label text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN label IS NULL OR btrim(label)='' THEN NULL
  WHEN btrim(label) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN NULL
  WHEN btrim(label) ~* '^(speaker[[:space:]]*[0-9]+|unknown speaker|unknown|guest|participant)$' THEN NULL
  ELSE nullif(btrim(regexp_replace(regexp_replace(lower(btrim(label)),'[._-]+',' ','g'),'[[:space:]]+',' ','g')),'')
 END
$$;
--> statement-breakpoint
-- Colleagues of a workspace, not external guests invited to single meetings.
CREATE FUNCTION app_private.is_internal_member(target_team uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.team_memberships WHERE team_id=target_team AND user_id=app_private.current_user_id() AND role<>'external')
$$;
--> statement-breakpoint
-- Merging rewrites speaker links across meetings, so it needs a workspace admin
-- or the right to edit speakers in every affected meeting.
CREATE FUNCTION app_private.can_merge_person(target_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_people p JOIN public.team_memberships tm ON tm.team_id=p.team_id
  WHERE p.id=target_person AND tm.user_id=app_private.current_user_id() AND tm.role IN ('owner','admin'))
 OR (app_private.is_internal_member((SELECT team_id FROM public.workspace_people WHERE id=target_person))
  AND NOT EXISTS(SELECT 1 FROM public.meeting_speakers g WHERE g.person_id=target_person AND NOT app_private.can_manage_speaker(g.meeting_id)))
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.remember_person_name(target_person uuid, target_team uuid, label text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 INSERT INTO public.person_names(person_id,team_id,name_key,name)
 SELECT target_person,target_team,app_private.person_name_key(label),btrim(label)
 -- A lone first name is too common to attribute future speakers by.
 WHERE app_private.person_name_key(label) LIKE '% %'
 ON CONFLICT (person_id,name_key) DO NOTHING
$$;
--> statement-breakpoint
-- The single active person in a workspace known by this email or remembered
-- name. Two candidates means ambiguous, which returns NULL.
CREATE FUNCTION app_private.unique_person_for(target_team uuid, label text, target_meeting uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidates uuid[]; key text:=app_private.person_name_key(label); v_email text:=lower(btrim(label));
BEGIN
 IF label IS NULL THEN RETURN NULL; END IF;
 IF v_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
  SELECT array_agg(DISTINCT p.id) INTO candidates FROM public.person_emails e
  JOIN public.workspace_people p ON p.id=e.person_id AND p.merged_into_id IS NULL
  WHERE e.team_id=target_team AND e.email=v_email;
  RETURN CASE WHEN cardinality(candidates)=1 THEN candidates[1] END;
 END IF;
 IF key IS NULL THEN RETURN NULL; END IF;
 IF key LIKE '% %' THEN
 SELECT array_agg(DISTINCT n.person_id) INTO candidates FROM public.person_names n
 JOIN public.workspace_people p ON p.id=n.person_id AND p.merged_into_id IS NULL
 WHERE n.team_id=target_team AND n.name_key=key;
 IF cardinality(candidates)>=1 THEN RETURN CASE WHEN cardinality(candidates)=1 THEN candidates[1] END; END IF;
 END IF;
 -- The meeting's participant list can bind this name to a confirmed email.
 IF target_meeting IS NOT NULL THEN
  SELECT array_agg(DISTINCT p.id) INTO candidates FROM public.meeting_participant_timeline t
  JOIN public.person_emails e ON e.team_id=target_team AND e.email=lower(btrim(t.email))
  JOIN public.workspace_people p ON p.id=e.person_id AND p.merged_into_id IS NULL
  WHERE t.meeting_id=target_meeting AND app_private.person_name_key(t.name)=key;
  RETURN CASE WHEN cardinality(candidates)=1 THEN candidates[1] END;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
-- New transcript speaker groups inherit a person from a confirmed email or a
-- remembered name. Only ingestion groups (with a source bucket) are touched;
-- manual corrections and existing groups never change here.
CREATE FUNCTION app_private.auto_attribute_speaker() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.person_id IS NULL AND NEW.source_bucket_key IS NOT NULL AND NEW.source_label IS NOT NULL THEN
  NEW.person_id:=app_private.unique_person_for((SELECT team_id FROM public.meetings WHERE id=NEW.meeting_id),NEW.source_label,NEW.meeting_id);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER meeting_speakers_auto_attribute BEFORE INSERT ON meeting_speakers FOR EACH ROW EXECUTE FUNCTION app_private.auto_attribute_speaker();
--> statement-breakpoint
-- Merge duplicates into target. Emails, names and speaker links move; the
-- sources redirect. Who said what is unchanged, so meeting attribution
-- revisions (and the followups bound to them) stay valid.
CREATE FUNCTION app_private.merge_people(target uuid, sources uuid[], keep_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.workspace_people; s public.workspace_people; source_id uuid; actor uuid:=app_private.current_user_id(); known_names text[];
 target_emails jsonb; target_names jsonb;
BEGIN
 SELECT * INTO t FROM public.workspace_people WHERE id=target FOR UPDATE;
 IF t.id IS NULL OR NOT app_private.is_internal_member(t.team_id) THEN RAISE EXCEPTION 'Person not found' USING ERRCODE='42501'; END IF;
 IF NOT app_private.can_merge_person(t.id) THEN RAISE EXCEPTION 'Only an admin or someone who can edit all of these meetings can merge these people' USING ERRCODE='42501'; END IF;
 IF t.merged_into_id IS NOT NULL OR cardinality(sources) IS NULL OR cardinality(sources)=0 OR cardinality(sources)>20 THEN
  RAISE EXCEPTION 'Choose people to merge' USING ERRCODE='22023'; END IF;
 known_names:=ARRAY[t.preferred_name];
 -- What the target held before, so Undo can return exactly what moved.
 target_emails:=coalesce((SELECT jsonb_agg(email) FROM public.person_emails WHERE person_id=t.id),'[]'::jsonb);
 target_names:=coalesce((SELECT jsonb_agg(name_key) FROM public.person_names WHERE person_id=t.id),'[]'::jsonb);
 FOREACH source_id IN ARRAY sources LOOP
  SELECT * INTO s FROM public.workspace_people WHERE id=source_id FOR UPDATE;
  IF s.id IS NULL OR s.id=t.id OR s.team_id<>t.team_id OR s.merged_into_id IS NOT NULL THEN
   RAISE EXCEPTION 'Choose people from this workspace' USING ERRCODE='22023'; END IF;
  IF NOT app_private.can_merge_person(s.id) THEN RAISE EXCEPTION 'Only an admin or someone who can edit all of these meetings can merge these people' USING ERRCODE='42501'; END IF;
  INSERT INTO public.person_merges(team_id,target_person_id,source_person_id,actor_user_id,snapshot) VALUES(t.team_id,t.id,s.id,actor,jsonb_build_object(
   'preferredName',s.preferred_name,
   'emails',coalesce((SELECT jsonb_agg(email) FROM public.person_emails WHERE person_id=s.id),'[]'::jsonb),
   'names',coalesce((SELECT jsonb_agg(name) FROM public.person_names WHERE person_id=s.id),'[]'::jsonb),
   'meetingSpeakerIds',coalesce((SELECT jsonb_agg(id) FROM public.meeting_speakers WHERE person_id=s.id),'[]'::jsonb),
   'targetPreferredName',t.preferred_name,'targetEmails',target_emails,'targetNameKeys',target_names));
  INSERT INTO public.person_emails(person_id,team_id,email,confirmed_by,confirmed_at)
  SELECT t.id,t.team_id,email,confirmed_by,confirmed_at FROM public.person_emails WHERE person_id=s.id
  ON CONFLICT (person_id,email) DO NOTHING;
  DELETE FROM public.person_emails WHERE person_id=s.id;
  INSERT INTO public.person_names(person_id,team_id,name_key,name)
  SELECT t.id,t.team_id,name_key,name FROM public.person_names WHERE person_id=s.id
  ON CONFLICT (person_id,name_key) DO NOTHING;
  DELETE FROM public.person_names WHERE person_id=s.id;
  known_names:=known_names||s.preferred_name;
  INSERT INTO public.meeting_speaker_changes(meeting_id,actor_user_id,metadata)
  SELECT g.meeting_id,actor,jsonb_build_object('action','merge_people','meetingSpeakerId',g.id,'previousPersonId',s.id,'personId',t.id,'previousRevision',g.revision)
  FROM public.meeting_speakers g WHERE g.person_id=s.id;
  UPDATE public.meeting_speakers SET person_id=t.id,revision=revision+1,updated_at=now() WHERE person_id=s.id;
  UPDATE public.workspace_people SET merged_into_id=t.id,updated_at=now() WHERE id=s.id OR merged_into_id=s.id;
  DELETE FROM public.person_profiles WHERE person_id=s.id;
 END LOOP;
 PERFORM app_private.remember_person_name(t.id,t.team_id,n) FROM unnest(known_names) n;
 IF keep_name IS NOT NULL AND btrim(keep_name)<>'' THEN
  IF NOT (btrim(keep_name)=ANY(known_names)) THEN RAISE EXCEPTION 'Keep one of the merged names' USING ERRCODE='22023'; END IF;
  UPDATE public.workspace_people SET preferred_name=btrim(keep_name),updated_at=now() WHERE id=t.id;
 END IF;
 -- The merged history changes what a profile can say.
 DELETE FROM public.person_profiles WHERE person_id=t.id;
 RETURN jsonb_build_object('personId',t.id,'merged',to_jsonb(sources));
END $$;
--> statement-breakpoint
-- Undo the latest merge into target: every source merged in that same
-- statement returns with its emails, names and speaker links.
CREATE FUNCTION app_private.unmerge_people(target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.workspace_people; batch timestamptz; r public.person_merges; restored uuid[]:='{}';
BEGIN
 SELECT * INTO t FROM public.workspace_people WHERE id=target FOR UPDATE;
 IF t.id IS NULL OR NOT app_private.is_internal_member(t.team_id) THEN RAISE EXCEPTION 'Person not found' USING ERRCODE='42501'; END IF;
 IF NOT app_private.can_merge_person(t.id) THEN RAISE EXCEPTION 'Only an admin or someone who can edit all of these meetings can undo this merge' USING ERRCODE='42501'; END IF;
 SELECT max(created_at) INTO batch FROM public.person_merges WHERE target_person_id=t.id;
 IF batch IS NULL THEN RAISE EXCEPTION 'Nothing to undo' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT * FROM public.person_merges WHERE target_person_id=t.id AND created_at=batch FOR UPDATE LOOP
  IF NOT EXISTS(SELECT 1 FROM public.workspace_people WHERE id=r.source_person_id AND merged_into_id=t.id) THEN
   RAISE EXCEPTION 'This merge can no longer be undone' USING ERRCODE='22023'; END IF;
  UPDATE public.workspace_people SET merged_into_id=NULL,updated_at=now() WHERE id=r.source_person_id;
  INSERT INTO public.meeting_speaker_changes(meeting_id,actor_user_id,metadata)
  SELECT g.meeting_id,app_private.current_user_id(),jsonb_build_object('action','unmerge_people','meetingSpeakerId',g.id,'previousPersonId',t.id,'personId',r.source_person_id,'previousRevision',g.revision)
  FROM public.meeting_speakers g WHERE g.person_id=t.id AND g.id IN (SELECT jsonb_array_elements_text(r.snapshot->'meetingSpeakerIds')::uuid);
  UPDATE public.meeting_speakers SET person_id=r.source_person_id,revision=revision+1,updated_at=now()
  WHERE person_id=t.id AND id IN (SELECT jsonb_array_elements_text(r.snapshot->'meetingSpeakerIds')::uuid);
  INSERT INTO public.person_emails(person_id,team_id,email,confirmed_by)
  SELECT r.source_person_id,t.team_id,e,r.actor_user_id FROM jsonb_array_elements_text(r.snapshot->'emails') e
  ON CONFLICT (person_id,email) DO NOTHING;
  DELETE FROM public.person_emails WHERE person_id=t.id
   AND email IN (SELECT jsonb_array_elements_text(r.snapshot->'emails'))
   AND NOT (to_jsonb(email) <@ coalesce(r.snapshot->'targetEmails','[]'::jsonb));
  PERFORM app_private.remember_person_name(r.source_person_id,t.team_id,n) FROM jsonb_array_elements_text(r.snapshot->'names') n;
  DELETE FROM public.person_names WHERE person_id=t.id
   AND NOT (to_jsonb(name_key) <@ coalesce(r.snapshot->'targetNameKeys','[]'::jsonb));
  UPDATE public.workspace_people SET preferred_name=coalesce(r.snapshot->>'targetPreferredName',preferred_name),updated_at=now() WHERE id=t.id;
  DELETE FROM public.person_profiles WHERE person_id IN (t.id,r.source_person_id);
  DELETE FROM public.person_merges WHERE id=r.id;
  restored:=restored||r.source_person_id;
 END LOOP;
 RETURN jsonb_build_object('personId',t.id,'restored',to_jsonb(restored));
END $$;
--> statement-breakpoint
-- Any colleague can move a followup to do between To do, In progress and Done;
-- the row records who changed it last and when.
CREATE FUNCTION app_private.set_todo_status(target_meeting uuid, key text, new_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE team uuid; actor uuid:=app_private.current_user_id(); result jsonb;
BEGIN
 SELECT team_id INTO team FROM public.meetings WHERE id=target_meeting;
 IF team IS NULL OR NOT app_private.is_internal_member(team) THEN RAISE EXCEPTION 'Meeting not found' USING ERRCODE='42501'; END IF;
 IF new_status NOT IN ('todo','in_progress','done') OR key IS NULL OR length(key)=0 OR length(key)>128 THEN RAISE EXCEPTION 'Choose a valid status' USING ERRCODE='22023'; END IF;
 INSERT INTO public.followup_todo_states(team_id,meeting_id,todo_key,status,updated_by,updated_at)
 VALUES(team,target_meeting,key,new_status,actor,now())
 ON CONFLICT (meeting_id,todo_key) DO UPDATE SET status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 SELECT jsonb_build_object('status',s.status,'updatedAt',s.updated_at,'updatedBy',coalesce(nullif(btrim(u.name),''),u.email))
 INTO result FROM public.followup_todo_states s LEFT JOIN public.users u ON u.id=s.updated_by
 WHERE s.meeting_id=target_meeting AND s.todo_key=key;
 RETURN result;
END $$;
--> statement-breakpoint
-- A person page is team knowledge: colleagues (never external guests) see every
-- workspace meeting with the person. Transcripts stay behind meeting access;
-- canOpen says whether this viewer may open the meeting itself.
CREATE FUNCTION app_private.person_team_meetings(target_person uuid)
RETURNS TABLE(id uuid,title text,at timestamptz,"ownerName" text,"aiFollowup" jsonb,"canOpen" boolean,"talkMs" bigint,"totalMs" bigint,"wallMs" double precision,colleagues text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE team uuid; emails text[];
BEGIN
 SELECT p.team_id INTO team FROM public.workspace_people p WHERE p.id=target_person;
 IF team IS NULL OR NOT app_private.is_internal_member(team) THEN RAISE EXCEPTION 'Person not found' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(e.email),'{}') INTO emails FROM public.person_emails e WHERE e.person_id=target_person;
 RETURN QUERY
 WITH groups AS (SELECT g.id,g.meeting_id FROM public.meeting_speakers g WHERE g.person_id=target_person),
 candidates AS (
  SELECT meeting_id FROM groups
  UNION SELECT a.meeting_id FROM public.meeting_attendees a WHERE lower(a.email)=ANY(emails)
  UNION SELECT t.meeting_id FROM public.meeting_participant_timeline t WHERE lower(t.email)=ANY(emails)
  UNION SELECT m.id FROM public.meetings m JOIN public.calendar_events c ON c.id=m.calendar_event_id
   WHERE m.team_id=team AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.attendee_emails) e WHERE lower(e)=ANY(emails))),
 team_users AS (
  SELECT u.id,lower(u.email) email,coalesce(nullif(btrim(u.name),''),u.email) name
  FROM public.team_memberships tm JOIN public.users u ON u.id=tm.user_id WHERE tm.team_id=team AND tm.role<>'external')
 SELECT m.id,m.title,coalesce(m.started_at,(SELECT c.starts_at FROM public.calendar_events c WHERE c.id=m.calendar_event_id),m.created_at),
  coalesce(nullif(btrim(u.name),''),u.email),m.ai_followup,app_private.can_read_meeting(m.id),
  talk.person_ms,talk.total_ms,(extract(epoch FROM (m.ended_at-m.started_at))*1000)::double precision,
  (SELECT array_agg(DISTINCT tu.name ORDER BY tu.name) FROM team_users tu
   WHERE (tu.id=m.owner_user_id
    OR tu.email IN (SELECT lower(a.email) FROM public.meeting_attendees a WHERE a.meeting_id=m.id)
    OR tu.email IN (SELECT lower(t.email) FROM public.meeting_participant_timeline t WHERE t.meeting_id=m.id)
    OR tu.email IN (SELECT lower(e) FROM public.calendar_events c,jsonb_array_elements_text(c.attendee_emails) e WHERE c.id=m.calendar_event_id))
    AND NOT (tu.email=ANY(emails)))
 FROM public.meetings m JOIN public.users u ON u.id=m.owner_user_id
 LEFT JOIN LATERAL (
  SELECT sum(greatest(coalesce(s.end_ms,s.start_ms)-s.start_ms,1)) FILTER (WHERE s.meeting_speaker_id IN (SELECT g.id FROM groups g))::bigint person_ms,
   sum(greatest(coalesce(s.end_ms,s.start_ms)-s.start_ms,1))::bigint total_ms
  FROM public.transcript_segments s
  WHERE s.meeting_id=m.id AND s.job_id IN (SELECT app_private.speaker_current_jobs(m.id))) talk ON true
 WHERE m.team_id=team AND m.id IN (SELECT meeting_id FROM candidates) AND m.status<>'cancelled'
 ORDER BY 3 DESC LIMIT 201;
END $$;
--> statement-breakpoint
-- Current transcript lines of the given team meetings, with display names and
-- whether the person spoke each line. With only_subject, just their own lines.
CREATE FUNCTION app_private.person_team_segments(target_person uuid, meeting_ids uuid[], only_subject boolean)
RETURNS TABLE(id uuid,"meetingId" uuid,"startMs" integer,text text,speaker text,names text[],subject boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE team uuid;
BEGIN
 SELECT p.team_id INTO team FROM public.workspace_people p WHERE p.id=target_person;
 IF team IS NULL OR NOT app_private.is_internal_member(team) THEN RAISE EXCEPTION 'Person not found' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT s.id,s.meeting_id,s.start_ms,s.text,coalesce(p.preferred_name,g.display_name,s.speaker),
  array_remove(ARRAY[s.speaker,g.display_name,g.source_label],NULL),coalesce(g.person_id=target_person,false)
 FROM public.transcript_segments s
 JOIN public.meetings m ON m.id=s.meeting_id AND m.team_id=team
 LEFT JOIN public.meeting_speakers g ON g.id=s.meeting_speaker_id
 LEFT JOIN public.workspace_people p ON p.id=g.person_id
 WHERE s.meeting_id=ANY(meeting_ids) AND s.job_id IN (SELECT app_private.speaker_current_jobs(s.meeting_id))
  AND (NOT only_subject OR g.person_id=target_person)
 ORDER BY s.meeting_id,s.start_ms,s.id;
END $$;
--> statement-breakpoint
-- Workspace colleagues get no AI profile.
CREATE FUNCTION app_private.is_person_colleague(target_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_people p JOIN public.person_emails e ON e.person_id=p.id
  WHERE p.id=target_person AND (
   EXISTS(SELECT 1 FROM public.team_memberships tm JOIN public.users u ON u.id=tm.user_id WHERE tm.team_id=p.team_id AND tm.role<>'external' AND lower(u.email)=e.email)
   OR EXISTS(SELECT 1 FROM public.allowed_domains d WHERE d.team_id=p.team_id AND d.domain=split_part(e.email,'@',2))))
$$;
--> statement-breakpoint
-- Link an unnamed-in-the-directory speaker group to a workspace person, creating
-- one when needed, so every named speaker can open a page. Reuses a person found
-- by confirmed email, remembered name, or an exact unique full name.
CREATE FUNCTION app_private.open_speaker_person(target_meeting uuid, target_group uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.meetings; g public.meeting_speakers; label text; v_email text; person uuid; candidates uuid[]; emails text[]; actor uuid:=app_private.current_user_id();
BEGIN
 IF NOT app_private.can_manage_speaker(target_meeting) THEN RAISE EXCEPTION 'Meeting not found' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.meetings WHERE id=target_meeting;
 SELECT * INTO g FROM public.meeting_speakers WHERE id=target_group AND meeting_id=target_meeting FOR UPDATE;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Refresh transcript before opening this speaker' USING ERRCODE='40001'; END IF;
 IF g.person_id IS NOT NULL THEN
  SELECT coalesce(merged_into_id,id) INTO person FROM public.workspace_people WHERE id=g.person_id;
  RETURN person;
 END IF;
 label:=btrim(coalesce(g.display_name,g.source_label));
 IF label IS NULL OR (app_private.person_name_key(label) IS NULL AND label !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN
  RAISE EXCEPTION 'Name this speaker before opening a profile' USING ERRCODE='22023'; END IF;
 IF label ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
  v_email:=lower(label);
 ELSE
  SELECT array_agg(DISTINCT lower(btrim(t.email))) INTO emails FROM public.meeting_participant_timeline t
  WHERE t.meeting_id=target_meeting AND t.email LIKE '%_@_%' AND app_private.person_name_key(t.name)=app_private.person_name_key(label);
  IF cardinality(emails)=1 THEN v_email:=emails[1]; END IF;
 END IF;
 -- Two speakers with the same new name opened at once must not create two people.
 PERFORM pg_advisory_xact_lock(hashtext(m.team_id::text||':'||coalesce(v_email,app_private.person_name_key(label))));
 person:=app_private.unique_person_for(m.team_id,coalesce(v_email,label),target_meeting);
 IF person IS NULL AND v_email IS NOT NULL THEN person:=app_private.unique_person_for(m.team_id,label,target_meeting); END IF;
 IF person IS NULL AND label ~ '[[:alpha:]][[:space:]]+[[:alpha:]]' THEN
  SELECT array_agg(id) INTO candidates FROM public.workspace_people
  WHERE team_id=m.team_id AND merged_into_id IS NULL AND app_private.person_name_key(preferred_name)=app_private.person_name_key(label);
  IF cardinality(candidates)=1 THEN person:=candidates[1]; END IF;
 END IF;
 IF person IS NULL THEN
  INSERT INTO public.workspace_people(team_id,preferred_name,created_by)
  VALUES(m.team_id,CASE WHEN label LIKE '%@%' THEN split_part(label,'@',1) ELSE label END,actor) RETURNING id INTO person;
 END IF;
 IF v_email IS NOT NULL THEN
  INSERT INTO public.person_emails(person_id,team_id,email,confirmed_by) VALUES(person,m.team_id,v_email,actor) ON CONFLICT (person_id,email) DO NOTHING;
 END IF;
 UPDATE public.meeting_speakers SET person_id=person,revision=revision+1,updated_at=now() WHERE id=g.id;
 INSERT INTO public.meeting_speaker_changes(meeting_id,actor_user_id,metadata)
 VALUES(target_meeting,actor,jsonb_build_object('action','open_person','meetingSpeakerId',g.id,'previousPersonId',NULL,'personId',person,'previousRevision',g.revision));
 RETURN person;
END $$;
--> statement-breakpoint
-- A meeting participant known only by email gets a workspace person.
CREATE FUNCTION app_private.open_participant_person(target_meeting uuid, participant_email text, participant_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.meetings; v_email text:=lower(btrim(participant_email)); person uuid; v_name text:=nullif(btrim(participant_name),'');
BEGIN
 IF NOT app_private.can_manage_speaker(target_meeting) THEN RAISE EXCEPTION 'Meeting not found' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_private.speaker_participants(target_meeting) a WHERE a.email=v_email) THEN
  RAISE EXCEPTION 'Choose a participant of this meeting' USING ERRCODE='22023'; END IF;
 IF v_name IS NOT NULL AND (length(v_name)>80 OR v_name LIKE '%@%') THEN v_name:=NULL; END IF;
 SELECT * INTO m FROM public.meetings WHERE id=target_meeting;
 PERFORM pg_advisory_xact_lock(hashtext(m.team_id::text||':'||v_email));
 -- Several people may share a mailbox; open the earliest confirmed one.
 SELECT p.id INTO person FROM public.person_emails e JOIN public.workspace_people p ON p.id=e.person_id AND p.merged_into_id IS NULL
 WHERE e.team_id=m.team_id AND e.email=v_email ORDER BY e.confirmed_at,p.id LIMIT 1;
 IF person IS NULL THEN
  INSERT INTO public.workspace_people(team_id,preferred_name,created_by)
  VALUES(m.team_id,coalesce(v_name,initcap(regexp_replace(split_part(v_email,'@',1),'[._-]+',' ','g'))),app_private.current_user_id()) RETURNING id INTO person;
  INSERT INTO public.person_emails(person_id,team_id,email,confirmed_by) VALUES(person,m.team_id,v_email,app_private.current_user_id());
 END IF;
 RETURN person;
END $$;
--> statement-breakpoint
ALTER TABLE person_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_names FORCE ROW LEVEL SECURITY;
ALTER TABLE person_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_merges FORCE ROW LEVEL SECURITY;
ALTER TABLE person_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY person_names_read ON person_names FOR SELECT TO tape_authenticated,tape_mcp USING(app_private.is_internal_member(team_id));
CREATE POLICY person_merges_read ON person_merges FOR SELECT TO tape_authenticated USING(app_private.is_internal_member(team_id));
-- People pages are team knowledge: every colleague reads and refreshes the same profile.
CREATE POLICY person_profiles_team ON person_profiles FOR ALL TO tape_authenticated
 USING(app_private.is_internal_member(team_id))
 WITH CHECK(app_private.is_internal_member(team_id) AND generated_by=app_private.current_user_id()
  AND EXISTS(SELECT 1 FROM workspace_people p WHERE p.id=person_id AND p.team_id=person_profiles.team_id));
ALTER TABLE followup_todo_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_todo_states FORCE ROW LEVEL SECURITY;
CREATE POLICY followup_todo_states_read ON followup_todo_states FOR SELECT TO tape_authenticated USING(app_private.is_internal_member(team_id));
REVOKE ALL ON person_names,person_merges,person_profiles,followup_todo_states FROM tape_authenticated,tape_mcp;
GRANT SELECT ON followup_todo_states TO tape_authenticated;
GRANT SELECT ON person_names TO tape_authenticated,tape_mcp;
GRANT SELECT ON person_merges TO tape_authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON person_profiles TO tape_authenticated;
REVOKE ALL ON FUNCTION app_private.is_internal_member(uuid),app_private.can_merge_person(uuid),app_private.remember_person_name(uuid,uuid,text),app_private.unique_person_for(uuid,text,uuid),app_private.auto_attribute_speaker(),app_private.merge_people(uuid,uuid[],text),app_private.unmerge_people(uuid),app_private.set_todo_status(uuid,text,text),app_private.person_team_meetings(uuid),app_private.person_team_segments(uuid,uuid[],boolean),app_private.is_person_colleague(uuid),app_private.open_speaker_person(uuid,uuid),app_private.open_participant_person(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.merge_people(uuid,uuid[],text),app_private.unmerge_people(uuid),app_private.set_todo_status(uuid,text,text),app_private.person_team_meetings(uuid),app_private.person_team_segments(uuid,uuid[],boolean),app_private.is_person_colleague(uuid),app_private.open_speaker_person(uuid,uuid),app_private.open_participant_person(uuid,text,text) TO tape_authenticated;
GRANT EXECUTE ON FUNCTION app_private.person_name_key(text),app_private.is_internal_member(uuid),app_private.can_merge_person(uuid) TO tape_authenticated,tape_mcp;
