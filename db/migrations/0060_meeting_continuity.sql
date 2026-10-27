CREATE TABLE "meeting_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"source_meeting_id" uuid NOT NULL,
	"kind" text DEFAULT 'merge' NOT NULL,
	"continuation_recording_id" uuid,
	"dispatch_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_parts_not_self" CHECK ("meeting_parts"."meeting_id" <> "meeting_parts"."source_meeting_id"),
	CONSTRAINT "meeting_parts_kind_check" CHECK ("meeting_parts"."kind" in ('merge', 'continuation'))
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "bot_display_name" text;--> statement-breakpoint
ALTER TABLE "meeting_parts" ADD CONSTRAINT "meeting_parts_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_parts" ADD CONSTRAINT "meeting_parts_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_parts" ADD CONSTRAINT "meeting_parts_continuation_recording_id_recordings_id_fk" FOREIGN KEY ("continuation_recording_id") REFERENCES "public"."recordings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_parts_source_unique" ON "meeting_parts" USING btree ("source_meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_parts_continuation_unique" ON "meeting_parts" USING btree ("continuation_recording_id");--> statement-breakpoint
CREATE INDEX "meeting_parts_destination_index" ON "meeting_parts" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE meeting_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_parts FORCE ROW LEVEL SECURITY;
GRANT SELECT ON meeting_parts TO tape_authenticated, tape_mcp;
GRANT INSERT, UPDATE, DELETE ON meeting_parts TO tape_authenticated;
CREATE POLICY meeting_parts_read ON meeting_parts FOR SELECT TO tape_authenticated, tape_mcp
  USING (app_private.can_read_meeting(meeting_id) AND app_private.can_read_meeting(source_meeting_id));
CREATE POLICY meeting_parts_write ON meeting_parts FOR ALL TO tape_authenticated
  USING (app_private.can_write_meeting(meeting_id) AND app_private.can_write_meeting(source_meeting_id))
  WITH CHECK (app_private.can_write_meeting(meeting_id) AND app_private.can_write_meeting(source_meeting_id));
--> statement-breakpoint
-- Serialize membership changes within a team, including concurrent reverse merges.
-- Source records stay independent; this relation never grants source access.
CREATE FUNCTION app_private.validate_meeting_part() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target meetings; source meetings;
BEGIN
  SELECT * INTO STRICT target FROM meetings WHERE id = NEW.meeting_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(target.team_id::text, 6100));
  SELECT * INTO STRICT source FROM meetings WHERE id = NEW.source_meeting_id;
  IF target.id = source.id OR target.team_id <> source.team_id OR target.owner_user_id <> source.owner_user_id
     OR target.organization_access_enabled <> source.organization_access_enabled THEN
    RAISE EXCEPTION 'Meetings must have the same owner and sharing' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM meeting_parts WHERE source_meeting_id = target.id OR meeting_id = source.id) THEN
    RAISE EXCEPTION 'Nested meeting merges are not supported' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM meeting_parts WHERE meeting_id = target.id AND id <> NEW.id) >= 20 THEN
    RAISE EXCEPTION 'This meeting already contains 20 added parts' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    (SELECT user_id, role FROM meeting_access WHERE meeting_id = target.id AND revoked_at IS NULL
     EXCEPT SELECT user_id, role FROM meeting_access WHERE meeting_id = source.id AND revoked_at IS NULL)
    UNION ALL
    (SELECT user_id, role FROM meeting_access WHERE meeting_id = source.id AND revoked_at IS NULL
     EXCEPT SELECT user_id, role FROM meeting_access WHERE meeting_id = target.id AND revoked_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Meeting sharing changed. Refresh and try again' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.validate_meeting_part() FROM PUBLIC;
CREATE TRIGGER validate_meeting_part BEFORE INSERT OR UPDATE OF meeting_id, source_meeting_id ON meeting_parts
  FOR EACH ROW EXECUTE FUNCTION app_private.validate_meeting_part();

--> statement-breakpoint
-- Serialize claims with merge operations. The deadline is checked in the same
-- transaction that creates the source, so concurrent clicks cannot send two bots.
CREATE FUNCTION app_private.claim_meeting_continuation(
  target_id uuid, recording_id uuid, join_url text, join_platform meeting_platform,
  display_name text
) RETURNS TABLE(source_id uuid, claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target public.meetings%ROWTYPE;
DECLARE latest public.recordings%ROWTYPE;
DECLARE existing public.meeting_parts%ROWTYPE;
DECLARE child_id uuid;
BEGIN
  SELECT * INTO target FROM public.meetings WHERE id = target_id;
  IF NOT FOUND OR NOT app_private.can_write_meeting(target_id) THEN
    RAISE EXCEPTION 'Meeting not found' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target.team_id::text, 6100));
  IF EXISTS (SELECT 1 FROM public.meeting_parts WHERE source_meeting_id = target_id) THEN
    RAISE EXCEPTION 'Open the combined meeting to continue recording' USING ERRCODE = '23514';
  END IF;
  SELECT r.* INTO latest FROM public.recordings r
    WHERE (r.meeting_id = target_id OR r.meeting_id IN
      (SELECT source_meeting_id FROM public.meeting_parts WHERE meeting_id = target_id))
      AND r.ended_at IS NOT NULL
    ORDER BY r.ended_at DESC, r.id LIMIT 1;
  IF latest.id IS NULL OR recording_id IS NULL OR latest.id IS DISTINCT FROM recording_id OR latest.ended_at > clock_timestamp()
     OR latest.ended_at <= clock_timestamp() - interval '1 hour' THEN
    RAISE EXCEPTION 'Continue recording is available for one hour after the recording ends.' USING ERRCODE = '23514';
  END IF;
  IF NOT app_private.can_write_meeting(latest.meeting_id) THEN
    RAISE EXCEPTION 'Recording unavailable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM public.meeting_parts WHERE continuation_recording_id = recording_id;
  IF FOUND AND existing.meeting_id <> target_id THEN
    RAISE EXCEPTION 'This recording was already continued in another meeting.' USING ERRCODE = '23514';
  END IF;
  IF existing.id IS NOT NULL AND existing.dispatch_state <> 'failed' THEN
    RETURN QUERY SELECT existing.source_meeting_id, false;
    RETURN;
  END IF;
  IF target.status IN ('cancelled','missed') THEN
    RAISE EXCEPTION 'Meeting unavailable for continuation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meetings m WHERE
      (m.id = target_id OR m.id IN (SELECT source_meeting_id FROM public.meeting_parts WHERE meeting_id = target_id))
      AND m.status IN ('scheduled', 'recording')) THEN
    RAISE EXCEPTION 'A recording is already joining or in progress.' USING ERRCODE = '23514';
  END IF;
  IF join_platform NOT IN ('zoom','google_meet') THEN
    RAISE EXCEPTION 'Unsupported meeting link' USING ERRCODE = '23514';
  END IF;
  IF existing.id IS NOT NULL THEN
    UPDATE public.meeting_parts SET dispatch_state = 'dispatching', updated_at = now() WHERE id = existing.id;
    UPDATE public.meetings SET status = 'scheduled', meeting_url = join_url, platform = join_platform,
      updated_at = now() WHERE id = existing.source_meeting_id AND recall_bot_id IS NULL;
    RETURN QUERY SELECT existing.source_meeting_id, true;
    RETURN;
  END IF;
  INSERT INTO public.meetings(team_id, owner_user_id, organization_access_enabled, title, title_source,
    platform, status, meeting_url, started_at, bot_organization_domain, bot_display_name)
    VALUES(target.team_id, target.owner_user_id, target.organization_access_enabled, target.title, 'manual',
      join_platform, 'scheduled', join_url, now(), (select bot_organization_domain from public.meetings where id=latest.meeting_id), display_name)
    RETURNING id INTO child_id;
  INSERT INTO public.meeting_access(meeting_id,user_id,role,source,source_id,created_by_user_id)
    SELECT child_id,a.user_id,a.role,'manual','direct',target.owner_user_id FROM public.meeting_access a
    WHERE a.meeting_id = target_id AND a.revoked_at IS NULL;
  INSERT INTO public.meeting_attendees(meeting_id,email,is_internal)
    SELECT child_id,email,is_internal FROM public.meeting_attendees WHERE meeting_id = target_id;
  INSERT INTO public.meeting_parts(meeting_id,source_meeting_id,kind,continuation_recording_id,dispatch_state)
    VALUES(target_id,child_id,'continuation',recording_id,'dispatching');
  RETURN QUERY SELECT child_id,true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.claim_meeting_continuation(uuid,uuid,text,meeting_platform,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.claim_meeting_continuation(uuid,uuid,text,meeting_platform,text) TO tape_authenticated;
