create or replace function app_private.readable_meeting_ids()
returns table (meeting_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with current_identity as materialized (
    select
      app_private.current_user_id() as user_id,
      app_private.is_global_admin() as is_global_admin
  )
  select meeting.id
  from public.meetings as meeting
  cross join current_identity
  where current_identity.is_global_admin
    or meeting.owner_user_id = current_identity.user_id
    or exists (
      select 1
      from public.team_memberships as membership
      where membership.team_id = meeting.team_id
        and membership.user_id = current_identity.user_id
        and membership.role in ('admin', 'owner')
    )
    or exists (
      select 1
      from public.meeting_access as access_grant
      where access_grant.meeting_id = meeting.id
        and access_grant.user_id = current_identity.user_id
        and access_grant.revoked_at is null
    )
$$;

revoke all on function app_private.readable_meeting_ids() from public;
grant execute on function app_private.readable_meeting_ids()
  to tape_authenticated, tape_mcp;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meeting_attendees',
    'meeting_access_sources',
    'meeting_access_exclusions',
    'recordings',
    'media_assets',
    'local_recording_attempts',
    'local_recordings',
    'transcript_jobs',
    'transcript_segments',
    'meeting_entities',
    'meeting_participant_timeline',
    'meeting_reminders'
  ]
  loop
    execute format(
      'drop policy if exists meeting_child_read on public.%I',
      table_name
    );
    execute format(
      'create policy meeting_child_read on public.%I for select to tape_authenticated, tape_mcp using (meeting_id in (select readable.meeting_id from app_private.readable_meeting_ids() as readable))',
      table_name
    );
  end loop;
end
$$;
