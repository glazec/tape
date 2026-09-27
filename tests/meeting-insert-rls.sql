-- Run against an isolated database after replaying migrations. All fixtures roll back.
begin;

insert into public.teams (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Scheduling test'),
  ('10000000-0000-4000-8000-000000000002', 'Other workspace');
insert into public.users (id, auth_user_id, email) values
  ('20000000-0000-4000-8000-000000000001', 'scheduling-owner', 'owner@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'scheduling-colleague', 'colleague@example.test'),
  ('20000000-0000-4000-8000-000000000003', 'scheduling-admin', 'admin@example.test');
insert into public.team_memberships (team_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'member'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'admin');

set local role tape_authenticated;
select set_config('request.jwt.claims', '{"sub":"scheduling-owner"}', true);

-- The scheduling code inserts the meeting and returns its ID in one statement.
do $$
declare
  created_id uuid;
begin
  insert into public.meetings (id, team_id, owner_user_id, title, platform)
  values ('30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', 'New meeting', 'google_meet')
  returning id into created_id;
  if created_id is null then
    raise exception 'New meeting ID was not returned';
  end if;

  begin
    insert into public.meetings (team_id, owner_user_id, title, platform)
    values ('10000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001', 'Forbidden workspace', 'zoom')
    returning id into created_id;
    raise exception 'Cross-workspace insert was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.meetings (team_id, owner_user_id, title, platform)
    values ('10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002', 'Forbidden owner', 'zoom')
    returning id into created_id;
    raise exception 'Another owner could be assigned by a member';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claims', '{"sub":"scheduling-colleague"}', true);
do $$
begin
  if exists (select 1 from public.meetings) then
    raise exception 'Unshared meeting is visible to a colleague';
  end if;
end
$$;

select set_config('request.jwt.claims', '{"sub":"scheduling-admin"}', true);
do $$
declare
  created_id uuid;
begin
  if (select count(*) from public.meetings) <> 1 then
    raise exception 'Workspace administrator cannot read the meeting';
  end if;
  insert into public.meetings (team_id, owner_user_id, title, platform)
  values ('10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002', 'Admin scheduled meeting', 'zoom')
  returning id into created_id;
  if created_id is null then
    raise exception 'Administrator did not receive the new meeting ID';
  end if;
end
$$;

-- Explicit shares stay readable through both application and MCP roles.
reset role;
insert into public.meeting_access (meeting_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002', 'shared');
set local role tape_authenticated;
select set_config('request.jwt.claims', '{"sub":"scheduling-colleague"}', true);
do $$
begin
  if (select count(*) from public.meetings) <> 2 then
    raise exception 'Owned and explicitly shared meetings must be readable';
  end if;
end
$$;

set local role tape_mcp;
do $$
begin
  if (select count(*) from public.meetings) <> 2 then
    raise exception 'MCP cannot read owned and explicitly shared meetings';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"scheduling-owner"}', true);
update public.meeting_access set revoked_at = now()
where meeting_id = '30000000-0000-4000-8000-000000000001';
set local role tape_authenticated;
select set_config('request.jwt.claims', '{"sub":"scheduling-colleague"}', true);
do $$
begin
  if exists (
    select 1 from public.meetings
    where id = '30000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Revoked share is still readable';
  end if;
end
$$;

rollback;
