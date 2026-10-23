-- Run against an isolated database after replaying migrations. Fixtures roll back.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%', message; end if;
end
$$;

insert into public.teams (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Notes test');
insert into public.users (id, auth_user_id, email) values
  ('20000000-0000-4000-8000-000000000001', 'notes-owner', 'owner@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'notes-reader', 'reader@example.test');
insert into public.team_memberships (team_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member');
insert into public.meetings (id, team_id, owner_user_id, title, platform) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'Shared meeting', 'google_meet'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'Unshared meeting', 'google_meet');
insert into public.meeting_access (meeting_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'shared');

set local role tape_authenticated;
select set_config('request.jwt.claims', '{"sub":"notes-owner"}', true);
insert into public.meeting_notes (meeting_id, user_id, content) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Owner note');
select pg_temp.assert_true((select count(*) = 1 from public.meeting_notes), 'Owner cannot read own note');

select set_config('request.jwt.claims', '{"sub":"notes-reader"}', true);
select pg_temp.assert_true((select count(*) = 0 from public.meeting_notes), 'Reader can see another author note');
insert into public.meeting_notes (meeting_id, user_id, content) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Reader note');
with changed as (
  update public.meeting_notes set content = 'Edited after meeting', version = version + 1
  where version = 1 returning content
) select pg_temp.assert_true((select count(*) = 1 from changed), 'Reader cannot update own note');
with stale as (
  update public.meeting_notes set content = 'Stale overwrite' where version = 1 returning id
) select pg_temp.assert_true((select count(*) = 0 from stale), 'Stale write changed a note');

do $$
begin
  begin
    insert into public.meeting_notes (meeting_id, user_id, content) values
      ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Forbidden');
    raise exception 'Notes allowed on an inaccessible meeting';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.meeting_notes set user_id = '20000000-0000-4000-8000-000000000001';
    raise exception 'Note authorship could be changed';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claims', '{"sub":"notes-owner"}', true);
select pg_temp.assert_true((select count(*) = 1 from public.meeting_notes), 'Administrator can read another author note');
select pg_temp.assert_true((select content = 'Owner note' from public.meeting_notes), 'Another reader changed the owner note');

set local role tape_mcp;
do $$
begin
  begin
    perform * from public.meeting_notes;
    raise exception 'MCP can read personal notes';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
delete from public.meeting_access where user_id = '20000000-0000-4000-8000-000000000002';
set local role tape_authenticated;
select set_config('request.jwt.claims', '{"sub":"notes-reader"}', true);
select pg_temp.assert_true((select count(*) = 0 from public.meeting_notes), 'Notes remain readable after access is revoked');
with changed as (
  update public.meeting_notes set content = 'After access revoked' returning id
) select pg_temp.assert_true((select count(*) = 0 from changed), 'Notes remain editable after access is revoked');

rollback;
