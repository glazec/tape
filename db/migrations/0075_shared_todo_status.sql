ALTER TABLE "followup_todo_states" DROP CONSTRAINT "followup_todo_states_status_check";--> statement-breakpoint
UPDATE followup_todo_states SET status='todo' WHERE status='in_progress';
--> statement-breakpoint
ALTER TABLE "followup_todo_states" ADD CONSTRAINT "followup_todo_states_status_check" CHECK ("followup_todo_states"."status" in ('todo', 'done', 'cancelled'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.set_todo_status(target_meeting uuid, key text, new_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE team uuid; actor uuid:=app_private.current_user_id(); result jsonb;
BEGIN
 SELECT team_id INTO team FROM public.meetings WHERE id=target_meeting;
 IF team IS NULL OR NOT app_private.is_internal_member(team) THEN RAISE EXCEPTION 'Meeting not found' USING ERRCODE='42501'; END IF;
 IF new_status NOT IN ('todo','done','cancelled') OR key IS NULL OR length(key)=0 OR length(key)>128 THEN RAISE EXCEPTION 'Choose a valid status' USING ERRCODE='22023'; END IF;
 INSERT INTO public.followup_todo_states(team_id,meeting_id,todo_key,status,updated_by,updated_at)
 VALUES(team,target_meeting,key,new_status,actor,now())
 ON CONFLICT (meeting_id,todo_key) DO UPDATE SET status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 SELECT jsonb_build_object('status',s.status,'updatedAt',s.updated_at,'updatedBy',coalesce(nullif(btrim(u.name),''),u.email))
 INTO result FROM public.followup_todo_states s LEFT JOIN public.users u ON u.id=s.updated_by
 WHERE s.meeting_id=target_meeting AND s.todo_key=key;
 RETURN result;
END $$;
