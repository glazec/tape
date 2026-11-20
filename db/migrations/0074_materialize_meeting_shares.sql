-- Resharers can create grants, but cannot SELECT other recipients' private rows.
-- PostgreSQL applies the SELECT policy to ON CONFLICT DO UPDATE.
create function app_private.materialize_meeting_share_source(
  target_source_id uuid,
  target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  grant_source public.meeting_access_sources%rowtype;
  actor_id uuid := app_private.current_user_id();
begin
  select source.*
  into grant_source
  from public.meeting_access_sources as source
  join public.meeting_share_policies as policy
    on policy.id::text = source.source_id
  join public.meetings as meeting on meeting.id = source.meeting_id
  where source.id = target_source_id
    and source.source = 'share_policy'
    and source.role = 'shared'
    and source.revoked_at is null
    and source.created_by_user_id = actor_id
    and policy.revoked_at is null
    and policy.role = 'shared'
    and policy.recipient_email = source.recipient_email
    and policy.team_id = meeting.team_id
    and policy.owner_user_id = meeting.owner_user_id
    and (
      (policy.seed_meeting_id = source.meeting_id
        and app_private.can_share_meeting(source.meeting_id)
        and (policy.created_by_user_id = actor_id
          or app_private.can_write_meeting(source.meeting_id)))
      or (policy.scope = 'related'
        and app_private.can_write_meeting(policy.seed_meeting_id)
        and app_private.can_write_meeting(source.meeting_id))
    )
    and not exists (
      select 1 from public.meeting_access_exclusions as exclusion
      where exclusion.meeting_id = source.meeting_id
        and exclusion.recipient_email = source.recipient_email
    );

  if not found then
    return false;
  end if;

  if target_user_id is not null then
    if not exists (
      select 1 from public.users as recipient
      where recipient.id = target_user_id
        and lower(recipient.email) = grant_source.recipient_email
    ) then
      return false;
    end if;

    insert into public.meeting_access (
      meeting_id, user_id, role, source, source_id, created_by_user_id
    ) values (
      grant_source.meeting_id, target_user_id, 'shared', 'effective', 'materialized', actor_id
    )
    on conflict (meeting_id, user_id) do update
    set role = excluded.role,
        source = excluded.source,
        source_id = excluded.source_id,
        created_by_user_id = excluded.created_by_user_id,
        revoked_at = null,
        updated_at = now();
  else
    insert into public.meeting_share_invites (
      meeting_id, email, role, source, source_id, created_by_user_id
    ) values (
      grant_source.meeting_id, grant_source.recipient_email,
      'shared', 'effective', 'materialized', actor_id
    )
    on conflict (meeting_id, email) do update
    set role = excluded.role,
        source = excluded.source,
        source_id = excluded.source_id,
        created_by_user_id = excluded.created_by_user_id,
        accepted_at = null,
        revoked_at = null,
        updated_at = now();
  end if;

  return true;
end
$$;

revoke all on function app_private.materialize_meeting_share_source(uuid, uuid)
  from public;
grant execute on function app_private.materialize_meeting_share_source(uuid, uuid)
  to tape_authenticated;
