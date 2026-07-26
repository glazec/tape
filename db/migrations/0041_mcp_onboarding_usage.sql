create unique index audit_events_onboarding_mcp_use_unique
  on public.audit_events (team_id, actor_user_id, action)
  where action = 'onboarding_mcp_used'
    and actor_user_id is not null;

create or replace function app_private.record_mcp_onboarding_use(
  target_team_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
begin
  actor_id := app_private.current_user_id();

  if actor_id is null
    or target_team_id is null
    or not app_private.can_discover_team(target_team_id)
  then
    raise insufficient_privilege
      using message = 'MCP onboarding usage requires an accessible workspace';
  end if;

  insert into public.audit_events (
    team_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    target_team_id,
    actor_id,
    'onboarding_mcp_used',
    'user',
    actor_id::text,
    '{}'::jsonb
  )
  on conflict do nothing;

  return true;
end
$$;

revoke all on function app_private.record_mcp_onboarding_use(uuid)
  from public;
grant execute on function app_private.record_mcp_onboarding_use(uuid)
  to tape_mcp;
