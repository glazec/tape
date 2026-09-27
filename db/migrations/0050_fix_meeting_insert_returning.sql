-- INSERT ... RETURNING checks SELECT policies before a stable function can
-- find the new row by ID. Evaluate owner and team permissions on the row itself.
-- Keep the existing helper for global administrators and explicit shares.
drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings
  for select to tape_authenticated, tape_mcp
  using (
    owner_user_id = app_private.current_user_id()
    or app_private.can_manage_team(team_id)
    or app_private.can_read_meeting(id)
  );
