create or replace function app_private.can_insert_share_policy(
  target_team_id uuid,
  target_owner_user_id uuid,
  target_seed_meeting_id uuid,
  target_created_by_user_id uuid,
  target_scope text,
  target_role public.access_role
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select target_created_by_user_id = app_private.current_user_id()
    and target_role = 'shared'::public.access_role
    and exists (
      select 1
      from public.meetings as meeting
      where meeting.id = target_seed_meeting_id
        and meeting.team_id = target_team_id
        and meeting.owner_user_id = target_owner_user_id
        and app_private.can_share_meeting(meeting.id)
        and (
          target_scope = 'single'
          or app_private.can_write_meeting(meeting.id)
        )
    )
$$;

create or replace function app_private.can_update_share_policy(
  target_team_id uuid,
  target_owner_user_id uuid,
  target_seed_meeting_id uuid,
  target_created_by_user_id uuid,
  target_scope text,
  target_role public.access_role
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select target_role = 'shared'::public.access_role
    and exists (
      select 1
      from public.meetings as meeting
      where meeting.id = target_seed_meeting_id
        and meeting.team_id = target_team_id
        and meeting.owner_user_id = target_owner_user_id
        and app_private.can_share_meeting(meeting.id)
        and (
          app_private.can_write_meeting(meeting.id)
          or (
            target_scope = 'single'
            and target_created_by_user_id = app_private.current_user_id()
          )
        )
    )
$$;

revoke all on function app_private.can_insert_share_policy(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.access_role
) from public;
grant execute on function app_private.can_insert_share_policy(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.access_role
) to tape_authenticated;

revoke all on function app_private.can_update_share_policy(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.access_role
) from public;
grant execute on function app_private.can_update_share_policy(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.access_role
) to tape_authenticated;

drop policy if exists meeting_share_policies_insert
  on public.meeting_share_policies;
create policy meeting_share_policies_insert on public.meeting_share_policies
  for insert to tape_authenticated
  with check (
    app_private.can_insert_share_policy(
      team_id,
      owner_user_id,
      seed_meeting_id,
      created_by_user_id,
      scope,
      role
    )
  );

drop policy if exists meeting_share_policies_update
  on public.meeting_share_policies;
create policy meeting_share_policies_update on public.meeting_share_policies
  for update to tape_authenticated
  using (app_private.can_write_share_policy(id))
  with check (
    app_private.can_update_share_policy(
      team_id,
      owner_user_id,
      seed_meeting_id,
      created_by_user_id,
      scope,
      role
    )
  );
