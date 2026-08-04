create or replace function app_private.can_read_share_policy_values(
  target_policy_id uuid,
  target_team_id uuid,
  target_seed_meeting_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.can_read_team(target_team_id)
    or (
      target_seed_meeting_id is not null
      and app_private.can_share_meeting(target_seed_meeting_id)
    )
    or exists (
      select 1
      from public.meeting_access_sources as source
      where source.source = 'share_policy'
        and source.source_id = target_policy_id::text
        and source.revoked_at is null
        and app_private.can_share_meeting(source.meeting_id)
    )
$$;

revoke all on function app_private.can_read_share_policy_values(
  uuid,
  uuid,
  uuid
) from public;
grant execute on function app_private.can_read_share_policy_values(
  uuid,
  uuid,
  uuid
) to tape_authenticated, tape_mcp;

drop policy if exists meeting_share_policies_read
  on public.meeting_share_policies;
create policy meeting_share_policies_read on public.meeting_share_policies
  for select to tape_authenticated, tape_mcp
  using (
    app_private.can_read_share_policy_values(
      id,
      team_id,
      seed_meeting_id
    )
  );
