create or replace function app_private.can_share_meeting(target_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.can_read_meeting(target_meeting_id)
$$;

create or replace function app_private.can_read_share_policy(target_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.meeting_share_policies as policy
    where policy.id = target_policy_id
      and (
        app_private.can_read_team(policy.team_id)
        or (
          policy.seed_meeting_id is not null
          and app_private.can_share_meeting(policy.seed_meeting_id)
        )
        or exists (
          select 1
          from public.meeting_access_sources as source
          where source.source = 'share_policy'
            and source.source_id = policy.id::text
            and source.revoked_at is null
            and app_private.can_share_meeting(source.meeting_id)
        )
      )
  )
$$;

create or replace function app_private.can_write_share_policy(target_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.meeting_share_policies as policy
    where policy.id = target_policy_id
      and policy.seed_meeting_id is not null
      and (
        app_private.can_write_meeting(policy.seed_meeting_id)
        or (
          policy.created_by_user_id = app_private.current_user_id()
          and app_private.can_share_meeting(policy.seed_meeting_id)
        )
      )
  )
$$;

revoke all on function app_private.can_share_meeting(uuid) from public;
grant execute on function app_private.can_share_meeting(uuid)
  to tape_authenticated, tape_mcp;

drop policy if exists tenant_read on public.meeting_share_policies;
drop policy if exists tenant_write on public.meeting_share_policies;

create policy meeting_share_policies_read on public.meeting_share_policies
  for select to tape_authenticated, tape_mcp
  using (app_private.can_read_share_policy(id));

create policy meeting_share_policies_insert on public.meeting_share_policies
  for insert to tape_authenticated
  with check (
    created_by_user_id = app_private.current_user_id()
    and role = 'shared'
    and exists (
      select 1
      from public.meetings as meeting
      where meeting.id = meeting_share_policies.seed_meeting_id
        and meeting.team_id = meeting_share_policies.team_id
        and meeting.owner_user_id = meeting_share_policies.owner_user_id
        and app_private.can_share_meeting(meeting.id)
        and (
          meeting_share_policies.scope = 'single'
          or app_private.can_write_meeting(meeting.id)
        )
    )
  );

create policy meeting_share_policies_update on public.meeting_share_policies
  for update to tape_authenticated
  using (app_private.can_write_share_policy(id))
  with check (
    role = 'shared'
    and exists (
      select 1
      from public.meetings as meeting
      where meeting.id = meeting_share_policies.seed_meeting_id
        and meeting.team_id = meeting_share_policies.team_id
        and meeting.owner_user_id = meeting_share_policies.owner_user_id
        and app_private.can_share_meeting(meeting.id)
        and (
          app_private.can_write_meeting(meeting.id)
          or (
            meeting_share_policies.scope = 'single'
            and meeting_share_policies.created_by_user_id =
              app_private.current_user_id()
          )
        )
    )
  );

create policy meeting_share_policies_delete on public.meeting_share_policies
  for delete to tape_authenticated
  using (app_private.can_write_share_policy(id));

drop policy if exists meeting_child_write
  on public.meeting_access_sources;

create policy meeting_access_sources_insert
  on public.meeting_access_sources
  for insert to tape_authenticated
  with check (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'share_policy'
      and created_by_user_id = app_private.current_user_id()
    )
  );

create policy meeting_access_sources_update
  on public.meeting_access_sources
  for update to tape_authenticated
  using (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'share_policy'
      and created_by_user_id = app_private.current_user_id()
    )
  )
  with check (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'share_policy'
      and created_by_user_id = app_private.current_user_id()
    )
  );

create policy meeting_access_sources_delete
  on public.meeting_access_sources
  for delete to tape_authenticated
  using (app_private.can_write_meeting(meeting_id));

drop policy if exists meeting_access_insert on public.meeting_access;
drop policy if exists meeting_access_update on public.meeting_access;
drop policy if exists meeting_access_delete on public.meeting_access;

create policy meeting_access_insert on public.meeting_access
  for insert to tape_authenticated
  with check (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'effective'
      and source_id = 'materialized'
      and created_by_user_id = app_private.current_user_id()
    )
    or (
      user_id = app_private.current_user_id()
      and exists (
        select 1
        from public.meeting_share_invites as invite
        where invite.meeting_id = meeting_access.meeting_id
          and lower(invite.email) = app_private.claim_email()
          and invite.role = meeting_access.role
          and invite.revoked_at is null
      )
    )
  );

create policy meeting_access_update on public.meeting_access
  for update to tape_authenticated
  using (
    app_private.can_write_meeting(meeting_id)
    or app_private.can_share_meeting(meeting_id)
    or user_id = app_private.current_user_id()
  )
  with check (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'effective'
      and source_id = 'materialized'
      and created_by_user_id = app_private.current_user_id()
    )
    or (
      user_id = app_private.current_user_id()
      and exists (
        select 1
        from public.meeting_share_invites as invite
        where invite.meeting_id = meeting_access.meeting_id
          and lower(invite.email) = app_private.claim_email()
          and invite.role = meeting_access.role
          and invite.revoked_at is null
      )
    )
  );

create policy meeting_access_delete on public.meeting_access
  for delete to tape_authenticated
  using (app_private.can_write_meeting(meeting_id));

create or replace function app_private.protect_meeting_access_reshare_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Administrative jobs bypass RLS but still execute row triggers.
  if nullif(current_setting('request.jwt.claims', true), '') is null then
    return new;
  end if;

  if app_private.can_write_meeting(old.meeting_id) then
    return new;
  end if;

  if app_private.can_share_meeting(old.meeting_id)
    and old.meeting_id is not distinct from new.meeting_id
    and old.user_id is not distinct from new.user_id
    and new.role = 'shared'
    and new.source = 'effective'
    and new.source_id = 'materialized'
    and new.created_by_user_id = app_private.current_user_id()
    and new.revoked_at is null
  then
    return new;
  end if;

  if old.meeting_id is not distinct from new.meeting_id
    and old.user_id is not distinct from new.user_id
    and new.user_id = app_private.current_user_id()
    and exists (
      select 1
      from public.meeting_share_invites as invite
      where invite.meeting_id = new.meeting_id
        and lower(invite.email) = app_private.claim_email()
        and invite.role = new.role
        and invite.revoked_at is null
    )
  then
    return new;
  end if;

  raise exception 'meeting access recipients may only accept access and resharers may only grant it'
    using errcode = '42501';
end
$$;

revoke all on function app_private.protect_meeting_access_reshare_update()
  from public;
grant execute on function app_private.protect_meeting_access_reshare_update()
  to tape_authenticated;

drop trigger if exists meeting_access_protect_reshare_update
  on public.meeting_access;
create trigger meeting_access_protect_reshare_update
before update on public.meeting_access
for each row
execute function app_private.protect_meeting_access_reshare_update();

drop policy if exists meeting_share_invites_insert
  on public.meeting_share_invites;
drop policy if exists meeting_share_invites_update
  on public.meeting_share_invites;
drop policy if exists meeting_share_invites_delete
  on public.meeting_share_invites;

create policy meeting_share_invites_insert
  on public.meeting_share_invites
  for insert to tape_authenticated
  with check (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'effective'
      and source_id = 'materialized'
      and created_by_user_id = app_private.current_user_id()
    )
  );

create policy meeting_share_invites_update
  on public.meeting_share_invites
  for update to tape_authenticated
  using (
    app_private.can_write_meeting(meeting_id)
    or app_private.can_share_meeting(meeting_id)
    or lower(email) = app_private.claim_email()
  )
  with check (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'effective'
      and source_id = 'materialized'
      and created_by_user_id = app_private.current_user_id()
    )
    or lower(email) = app_private.claim_email()
  );

create policy meeting_share_invites_delete
  on public.meeting_share_invites
  for delete to tape_authenticated
  using (
    app_private.can_write_meeting(meeting_id)
    or (
      app_private.can_share_meeting(meeting_id)
      and role = 'shared'
      and source = 'effective'
      and source_id = 'materialized'
      and created_by_user_id = app_private.current_user_id()
    )
  );

create or replace function app_private.protect_invite_recipient_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Administrative jobs bypass RLS but still execute row triggers.
  if nullif(current_setting('request.jwt.claims', true), '') is null then
    return new;
  end if;

  if app_private.can_write_meeting(old.meeting_id) then
    return new;
  end if;

  if app_private.can_share_meeting(old.meeting_id)
    and new.created_by_user_id = app_private.current_user_id()
    and old.meeting_id is not distinct from new.meeting_id
    and old.email is not distinct from new.email
    and new.role = 'shared'
    and new.source = 'effective'
    and new.source_id = 'materialized'
    and new.accepted_at is null
    and new.revoked_at is null
  then
    return new;
  end if;

  if lower(old.email) <> app_private.claim_email()
    or new.meeting_id is distinct from old.meeting_id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.source is distinct from old.source
    or new.source_id is distinct from old.source_id
    or new.revoked_at is distinct from old.revoked_at
    or new.accepted_at is null
  then
    raise exception 'invite recipients may only accept their own invite'
      using errcode = '42501';
  end if;

  return new;
end
$$;

drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete to tape_authenticated
  using (owner_user_id = app_private.current_user_id());
