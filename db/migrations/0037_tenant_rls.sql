do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tape_authenticated') then
    create role tape_authenticated
      nologin nosuperuser nocreatedb nocreaterole inherit nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'tape_mcp') then
    create role tape_mcp
      nologin nosuperuser nocreatedb nocreaterole inherit nobypassrls;
  end if;
end
$$;

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to tape_authenticated, tape_mcp;

create or replace function app_private.claim_text(claim_name text)
returns text
language plpgsql
stable
as $$
declare
  claims jsonb;
begin
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  return claims ->> claim_name;
exception
  when others then
    return null;
end
$$;

create or replace function app_private.claim_uuid(claim_name text)
returns uuid
language plpgsql
stable
as $$
declare
  claim_value text;
begin
  claim_value := app_private.claim_text(claim_name);

  if claim_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return claim_value::uuid;
  end if;

  return null;
end
$$;

create or replace function app_private.claim_email()
returns text
language sql
stable
as $$
  select lower(nullif(app_private.claim_text('email'), ''))
$$;

create or replace function app_private.claim_email_domain()
returns text
language sql
stable
as $$
  select case
    when position('@' in app_private.claim_email()) > 1
      then split_part(app_private.claim_email(), '@', 2)
    else null
  end
$$;

create or replace function app_private.is_global_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    app_private.claim_text('app_context_trusted') = 'true'
      and app_private.claim_text('app_global_admin') = 'true',
    false
  )
$$;

create or replace function app_private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    case
      when app_private.claim_text('app_context_trusted') = 'true'
        then app_private.claim_uuid('app_user_id')
      else null
    end,
    (
      select app_user.id
      from public.users as app_user
      where app_user.auth_user_id = app_private.claim_text('sub')
      limit 1
    )
  )
$$;

create or replace function app_private.can_discover_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.is_global_admin()
    or (
      app_private.claim_text('app_context_trusted') = 'true'
      and target_team_id = app_private.claim_uuid('app_team_id')
    )
    or exists (
      select 1
      from public.team_memberships as membership
      where membership.team_id = target_team_id
        and membership.user_id = app_private.current_user_id()
    )
    or exists (
      select 1
      from public.allowed_domains as allowed_domain
      where allowed_domain.team_id = target_team_id
        and lower(allowed_domain.domain) = app_private.claim_email_domain()
    )
$$;

create or replace function app_private.can_read_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.is_global_admin()
    or (
      app_private.claim_text('app_context_trusted') = 'true'
      and target_team_id = app_private.claim_uuid('app_team_id')
    )
    or exists (
      select 1
      from public.team_memberships as membership
      where membership.team_id = target_team_id
        and membership.user_id = app_private.current_user_id()
    )
$$;

create or replace function app_private.can_write_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.is_global_admin()
    or (
      app_private.claim_text('app_context_trusted') = 'true'
      and
      target_team_id = app_private.claim_uuid('app_team_id')
      and app_private.claim_uuid('app_user_id') is not null
    )
    or exists (
      select 1
      from public.team_memberships as membership
      where membership.team_id = target_team_id
        and membership.user_id = app_private.current_user_id()
        and membership.role in ('member', 'admin', 'owner')
    )
$$;

create or replace function app_private.can_manage_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.is_global_admin()
    or exists (
      select 1
      from public.team_memberships as membership
      where membership.team_id = target_team_id
        and membership.user_id = app_private.current_user_id()
        and membership.role in ('admin', 'owner')
    )
$$;

create or replace function app_private.can_read_meeting(target_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.is_global_admin()
    or exists (
      select 1
      from public.meetings as meeting
      where meeting.id = target_meeting_id
        and (
          meeting.owner_user_id = app_private.current_user_id()
          or exists (
            select 1
            from public.team_memberships as membership
            where membership.team_id = meeting.team_id
              and membership.user_id = app_private.current_user_id()
              and membership.role in ('admin', 'owner')
          )
          or exists (
            select 1
            from public.meeting_access as access_grant
            where access_grant.meeting_id = meeting.id
              and access_grant.user_id = app_private.current_user_id()
              and access_grant.revoked_at is null
          )
        )
    )
$$;

create or replace function app_private.can_write_meeting(target_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select app_private.is_global_admin()
    or exists (
      select 1
      from public.meetings as meeting
      where meeting.id = target_meeting_id
        and (
          meeting.owner_user_id = app_private.current_user_id()
          or app_private.can_manage_team(meeting.team_id)
        )
    )
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
      and app_private.can_read_team(policy.team_id)
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
      and app_private.can_write_team(policy.team_id)
  )
$$;

revoke all on function app_private.claim_text(text) from public;
revoke all on function app_private.claim_uuid(text) from public;
revoke all on function app_private.claim_email() from public;
revoke all on function app_private.claim_email_domain() from public;
revoke all on function app_private.is_global_admin() from public;
revoke all on function app_private.current_user_id() from public;
revoke all on function app_private.can_discover_team(uuid) from public;
revoke all on function app_private.can_read_team(uuid) from public;
revoke all on function app_private.can_write_team(uuid) from public;
revoke all on function app_private.can_manage_team(uuid) from public;
revoke all on function app_private.can_read_meeting(uuid) from public;
revoke all on function app_private.can_write_meeting(uuid) from public;
revoke all on function app_private.can_read_share_policy(uuid) from public;
revoke all on function app_private.can_write_share_policy(uuid) from public;

grant execute on all functions in schema app_private
  to tape_authenticated, tape_mcp;

grant usage on schema public to tape_authenticated, tape_mcp;
grant select, insert, update, delete on all tables in schema public
  to tape_authenticated;
grant select on all tables in schema public to tape_mcp;
alter default privileges in schema public
  grant select, insert, update, delete on tables to tape_authenticated;
alter default privileges in schema public
  grant select on tables to tape_mcp;

revoke all on table public.vendor_webhook_events from tape_authenticated;
revoke all on table public.vendor_webhook_events from tape_mcp;
revoke all on table public.request_rate_limits from tape_mcp;

alter table public.users enable row level security;
alter table public.users force row level security;
create policy users_read on public.users
  for select to tape_authenticated, tape_mcp
  using (
    app_private.is_global_admin()
    or id = app_private.current_user_id()
    or exists (
      select 1
      from public.team_memberships as mine
      join public.team_memberships as theirs on theirs.team_id = mine.team_id
      where mine.user_id = app_private.current_user_id()
        and theirs.user_id = users.id
    )
  );
create policy users_insert on public.users
  for insert to tape_authenticated
  with check (
    auth_user_id = app_private.claim_text('sub')
    and lower(email) = app_private.claim_email()
  );
create policy users_update on public.users
  for update to tape_authenticated
  using (
    app_private.is_global_admin()
    or id = app_private.current_user_id()
  )
  with check (
    app_private.is_global_admin()
    or (
      auth_user_id = app_private.claim_text('sub')
      and lower(email) = app_private.claim_email()
    )
  );
create policy users_delete on public.users
  for delete to tape_authenticated
  using (app_private.is_global_admin());

alter table public.teams enable row level security;
alter table public.teams force row level security;
create policy teams_read on public.teams
  for select to tape_authenticated, tape_mcp
  using (app_private.can_discover_team(id));
create policy teams_insert on public.teams
  for insert to tape_authenticated
  with check (
    app_private.current_user_id() is not null
    and app_private.claim_text('app_context_trusted') = 'true'
    and id = app_private.claim_uuid('app_team_id')
  );
create policy teams_update on public.teams
  for update to tape_authenticated
  using (app_private.can_manage_team(id))
  with check (app_private.can_manage_team(id));
create policy teams_delete on public.teams
  for delete to tape_authenticated
  using (app_private.can_manage_team(id));

alter table public.allowed_domains enable row level security;
alter table public.allowed_domains force row level security;
create policy allowed_domains_read on public.allowed_domains
  for select to tape_authenticated, tape_mcp
  using (
    app_private.can_read_team(team_id)
    or lower(domain) = app_private.claim_email_domain()
  );
create policy allowed_domains_write on public.allowed_domains
  for all to tape_authenticated
  using (app_private.can_manage_team(team_id))
  with check (app_private.can_manage_team(team_id));

alter table public.team_memberships enable row level security;
alter table public.team_memberships force row level security;
create policy team_memberships_read on public.team_memberships
  for select to tape_authenticated, tape_mcp
  using (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
    or app_private.can_read_team(team_id)
  );
create policy team_memberships_insert on public.team_memberships
  for insert to tape_authenticated
  with check (
    app_private.is_global_admin()
    or app_private.can_manage_team(team_id)
    or (
      user_id = app_private.current_user_id()
      and (
        (
          app_private.claim_text('app_context_trusted') = 'true'
          and team_id = app_private.claim_uuid('app_team_id')
          and role = 'owner'
          and not exists (
            select 1
            from public.team_memberships as existing_membership
            where existing_membership.team_id = team_memberships.team_id
          )
        )
        or (
          role = 'member'
          and exists (
            select 1
            from public.allowed_domains as allowed_domain
            where allowed_domain.team_id = team_memberships.team_id
              and lower(allowed_domain.domain) = app_private.claim_email_domain()
          )
        )
      )
    )
  );
create policy team_memberships_update on public.team_memberships
  for update to tape_authenticated
  using (app_private.can_manage_team(team_id))
  with check (app_private.can_manage_team(team_id));
create policy team_memberships_delete on public.team_memberships
  for delete to tape_authenticated
  using (app_private.can_manage_team(team_id));

alter table public.oauth_accounts enable row level security;
alter table public.oauth_accounts force row level security;
create policy oauth_accounts_read on public.oauth_accounts
  for select to tape_authenticated, tape_mcp
  using (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
  );
create policy oauth_accounts_write on public.oauth_accounts
  for all to tape_authenticated
  using (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
  )
  with check (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
  );

alter table public.calendar_connections enable row level security;
alter table public.calendar_connections force row level security;
create policy calendar_connections_read on public.calendar_connections
  for select to tape_authenticated, tape_mcp
  using (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
    or app_private.can_manage_team(team_id)
  );
create policy calendar_connections_write on public.calendar_connections
  for all to tape_authenticated
  using (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
    or app_private.can_manage_team(team_id)
  )
  with check (
    app_private.is_global_admin()
    or (
      user_id = app_private.current_user_id()
      and app_private.can_write_team(team_id)
    )
    or app_private.can_manage_team(team_id)
  );

alter table public.meetings enable row level security;
alter table public.meetings force row level security;
create policy meetings_read on public.meetings
  for select to tape_authenticated, tape_mcp
  using (app_private.can_read_meeting(id));
create policy meetings_insert on public.meetings
  for insert to tape_authenticated
  with check (
    app_private.can_write_team(team_id)
    and (
      owner_user_id = app_private.current_user_id()
      or app_private.can_manage_team(team_id)
    )
  );
create policy meetings_update on public.meetings
  for update to tape_authenticated
  using (app_private.can_write_meeting(id))
  with check (
    app_private.can_write_team(team_id)
    and (
      owner_user_id = app_private.current_user_id()
      or app_private.can_manage_team(team_id)
    )
  );
create policy meetings_delete on public.meetings
  for delete to tape_authenticated
  using (app_private.can_write_meeting(id));

alter table public.meeting_access enable row level security;
alter table public.meeting_access force row level security;
create policy meeting_access_read on public.meeting_access
  for select to tape_authenticated, tape_mcp
  using (
    app_private.is_global_admin()
    or user_id = app_private.current_user_id()
    or app_private.can_write_meeting(meeting_id)
  );
create policy meeting_access_insert on public.meeting_access
  for insert to tape_authenticated
  with check (
    app_private.can_write_meeting(meeting_id)
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
    or user_id = app_private.current_user_id()
  )
  with check (
    app_private.can_write_meeting(meeting_id)
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

alter table public.meeting_share_invites enable row level security;
alter table public.meeting_share_invites force row level security;
create policy meeting_share_invites_read on public.meeting_share_invites
  for select to tape_authenticated, tape_mcp
  using (
    app_private.can_write_meeting(meeting_id)
    or lower(email) = app_private.claim_email()
  );
create policy meeting_share_invites_insert on public.meeting_share_invites
  for insert to tape_authenticated
  with check (app_private.can_write_meeting(meeting_id));
create policy meeting_share_invites_update on public.meeting_share_invites
  for update to tape_authenticated
  using (
    app_private.can_write_meeting(meeting_id)
    or lower(email) = app_private.claim_email()
  )
  with check (
    app_private.can_write_meeting(meeting_id)
    or lower(email) = app_private.claim_email()
  );
create policy meeting_share_invites_delete on public.meeting_share_invites
  for delete to tape_authenticated
  using (app_private.can_write_meeting(meeting_id));

create or replace function app_private.protect_invite_recipient_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if app_private.can_write_meeting(old.meeting_id) then
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

revoke all on function app_private.protect_invite_recipient_update()
  from public;
grant execute on function app_private.protect_invite_recipient_update()
  to tape_authenticated;

create trigger meeting_share_invites_protect_recipient_update
before update on public.meeting_share_invites
for each row
execute function app_private.protect_invite_recipient_update();

alter table public.meeting_share_policy_keys enable row level security;
alter table public.meeting_share_policy_keys force row level security;
create policy meeting_share_policy_keys_read on public.meeting_share_policy_keys
  for select to tape_authenticated, tape_mcp
  using (app_private.can_read_share_policy(policy_id));
create policy meeting_share_policy_keys_write on public.meeting_share_policy_keys
  for all to tape_authenticated
  using (app_private.can_write_share_policy(policy_id))
  with check (app_private.can_write_share_policy(policy_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'team_vocabulary_terms',
    'team_speaker_aliases',
    'team_meeting_bot_profiles',
    'calendar_events',
    'meeting_share_policies',
    'meeting_share_rules',
    'local_recorder_devices',
    'local_recorder_device_sessions',
    'provider_usage_events',
    'meeting_library_views',
    'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy tenant_read on public.%I for select to tape_authenticated, tape_mcp using (app_private.can_read_team(team_id))',
      table_name
    );
    execute format(
      'create policy tenant_write on public.%I for all to tape_authenticated using (app_private.can_write_team(team_id)) with check (app_private.can_write_team(team_id))',
      table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meeting_attendees',
    'share_links',
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
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy meeting_child_read on public.%I for select to tape_authenticated, tape_mcp using (app_private.can_read_meeting(meeting_id))',
      table_name
    );
    execute format(
      'create policy meeting_child_write on public.%I for all to tape_authenticated using (app_private.can_write_meeting(meeting_id)) with check (app_private.can_write_meeting(meeting_id))',
      table_name
    );
  end loop;
end
$$;
