CREATE FUNCTION app_private.merge_people_impl(target uuid, sources uuid[], keep_name text, check_permissions boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.workspace_people; s public.workspace_people; source_id uuid; actor uuid:=app_private.current_user_id(); known_names text[];
 target_emails jsonb; target_names jsonb;
BEGIN
 SELECT * INTO t FROM public.workspace_people WHERE id=target FOR UPDATE;
 IF t.id IS NULL OR (check_permissions AND NOT app_private.is_internal_member(t.team_id)) THEN RAISE EXCEPTION 'Person not found' USING ERRCODE='42501'; END IF;
 IF check_permissions AND NOT app_private.can_merge_person(t.id) THEN RAISE EXCEPTION 'Only an admin or someone who can edit all of these meetings can merge these people' USING ERRCODE='42501'; END IF;
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
  IF check_permissions AND NOT app_private.can_merge_person(s.id) THEN RAISE EXCEPTION 'Only an admin or someone who can edit all of these meetings can merge these people' USING ERRCODE='42501'; END IF;
  INSERT INTO public.person_merges(team_id,target_person_id,source_person_id,actor_user_id,snapshot) VALUES(t.team_id,t.id,s.id,actor,jsonb_build_object(
   'preferredName',s.preferred_name,
   'emails',coalesce((SELECT jsonb_agg(email) FROM public.person_emails WHERE person_id=s.id),'[]'::jsonb),
   'names',coalesce((SELECT jsonb_agg(name) FROM public.person_names WHERE person_id=s.id),'[]'::jsonb),
   'meetingSpeakerIds',coalesce((SELECT jsonb_agg(id) FROM public.meeting_speakers WHERE person_id=s.id),'[]'::jsonb),
   'targetPreferredName',t.preferred_name,'targetEmails',target_emails,'targetNameKeys',target_names));
  -- Move nonoverlapping addresses without ever creating a second owner.
  DELETE FROM public.person_emails src USING public.person_emails dst
  WHERE src.person_id=s.id AND dst.person_id=t.id AND src.email=dst.email;
  UPDATE public.person_emails SET person_id=t.id WHERE person_id=s.id;
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
REVOKE ALL ON FUNCTION app_private.merge_people_impl(uuid,uuid[],text,boolean) FROM PUBLIC, tape_authenticated, tape_mcp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.merge_people(target uuid, sources uuid[], keep_name text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app_private.merge_people_impl(target,sources,keep_name,true)
$$;
--> statement-breakpoint
-- Recheck after each merge because a profile may connect several email groups.
DO $$
DECLARE owners uuid[];
BEGIN
 LOCK TABLE public.person_emails IN SHARE ROW EXCLUSIVE MODE;
 LOOP
  SELECT array_agg(person_id ORDER BY confirmed_at,person_id) INTO owners
  FROM public.person_emails GROUP BY team_id,email HAVING count(*)>1
  ORDER BY team_id,email LIMIT 1;
  EXIT WHEN owners IS NULL;
  PERFORM app_private.merge_people_impl(owners[1],owners[2:21],NULL,false);
 END LOOP;
END $$;
--> statement-breakpoint
DROP INDEX "person_emails_team_email_index";--> statement-breakpoint
CREATE UNIQUE INDEX "person_emails_team_email_unique" ON "person_emails" USING btree ("team_id","email");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.unmerge_people(target uuid) RETURNS jsonb
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
  -- A shared address in a historical snapshot stays with its surviving owner.
  UPDATE public.person_emails SET person_id=r.source_person_id
  WHERE person_id=t.id AND email IN (SELECT jsonb_array_elements_text(r.snapshot->'emails'))
   AND NOT (coalesce(r.snapshot->'targetEmails','[]'::jsonb) ? email);
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
CREATE OR REPLACE FUNCTION app_private.mutate_speaker(target_meeting uuid, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.meetings; anchor public.transcript_segments; old_group public.meeting_speakers; target_group uuid; target_person uuid;
 actor uuid:=app_private.current_user_id(); action text:=coalesce(input->>'linkAction','preserve'); scope text:=coalesce(input->>'applyTo','matching_speaker');
 label text:=btrim(input->>'speaker'); preferred text:=nullif(btrim(input->>'preferredName'),''); selected_email text:=nullif(lower(btrim(input->>'participantEmail')),'');
 email_owner uuid; group_count integer; changed boolean; previous_segments jsonb; result jsonb; legacy boolean:=NOT(input ? 'linkAction');
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
 IF selected_email IS NOT NULL THEN
  IF action NOT IN ('create','link') OR NOT EXISTS(SELECT 1 FROM app_private.speaker_participants(target_meeting) a WHERE a.email=selected_email) THEN
   RAISE EXCEPTION 'Choose a participant email and explicitly select or create a person' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(m.team_id::text||':'||selected_email));
  SELECT person_id INTO email_owner FROM public.person_emails WHERE team_id=m.team_id AND email=selected_email;
 END IF;
 target_person:=old_group.person_id;
 IF action='link' THEN
  SELECT coalesce(merged_into_id,id) INTO target_person FROM public.workspace_people WHERE id=(input->>'personId')::uuid AND team_id=m.team_id FOR UPDATE;
  IF target_person IS NULL THEN RAISE EXCEPTION 'Select a person from this workspace' USING ERRCODE='22023'; END IF;
  IF email_owner IS NOT NULL AND target_person<>email_owner THEN
   PERFORM app_private.merge_people(email_owner,ARRAY[target_person]);
   -- The merge may itself have reassigned the anchor and advanced its revision.
   SELECT * INTO old_group FROM public.meeting_speakers WHERE id=anchor.meeting_speaker_id;
   target_person:=email_owner;
  END IF;
 ELSIF action='create' AND email_owner IS NOT NULL THEN
  target_person:=email_owner;
 ELSIF action='create' THEN
  INSERT INTO public.workspace_people(team_id,preferred_name,created_by) VALUES(m.team_id,coalesce(preferred,label),actor) RETURNING id INTO target_person;
 ELSIF action='unlink' THEN target_person:=NULL;
 END IF;
 IF selected_email IS NOT NULL THEN
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
