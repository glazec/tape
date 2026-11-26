\if :{?seed}
insert into teams (id, name) values ('10000000-0000-4000-8000-000000000001', 'Upgrade test');
insert into users (id, auth_user_id, email) values
  ('20000000-0000-4000-8000-000000000001', 'upgrade-owner', 'owner@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'upgrade-reader', 'reader@example.test');
insert into team_memberships (team_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member');
insert into meetings (id, team_id, owner_user_id, title, platform) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'Shared meeting', 'google_meet');
insert into meeting_access (meeting_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'shared');
insert into meeting_notes (meeting_id, user_id, content) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Private legacy note');
\else
begin;
select 1 from person_notes limit 0;
select 1 from person_timeline_evidence limit 0;
set local role tape_authenticated;
select set_config('request.jwt.claims', '{"sub":"upgrade-owner"}', true);
do $$
begin
  if (select content from meeting_notes) is distinct from 'Private legacy note' then
    raise exception 'Owner lost the legacy note';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"upgrade-reader"}', true);
do $$
begin
  if not exists (select 1 from meetings where id = '30000000-0000-4000-8000-000000000001') then
    raise exception 'Reader lost the legacy share';
  end if;
  if exists (select 1 from meeting_notes) then
    raise exception 'Reader can see the legacy private note';
  end if;
end $$;
rollback;
\endif
