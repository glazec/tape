\set ON_ERROR_STOP on
BEGIN;

INSERT INTO teams (id, name) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Company migration test'),
  ('a1000000-0000-4000-8000-000000000002', 'Legacy IOSF migration test');
INSERT INTO users (id, auth_user_id, email) VALUES
  ('a1000000-0000-4000-8000-000000000003', 'iosf-migration-owner', 'migration.owner@iosf.vc'),
  ('a1000000-0000-4000-8000-000000000004', 'iosg-migration-admin', 'migration.admin@iosg.vc');
INSERT INTO team_memberships (team_id, user_id, role) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'member'),
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'admin'),
  ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'owner');
INSERT INTO allowed_domains (team_id, domain)
VALUES ('a1000000-0000-4000-8000-000000000001', 'iosg.vc');
INSERT INTO team_meeting_bot_profiles (team_id, domain, bot_name, avatar_jpeg_base64)
VALUES ('a1000000-0000-4000-8000-000000000001', '', 'Original IOSG bot', 'original-avatar');

\ir ../db/migrations/0054_iosg_iosf_company.sql

INSERT INTO calendar_connections (id, team_id, user_id, external_calendar_id, recall_calendar_id, auto_join_enabled)
VALUES ('a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'primary', 'migration-test-calendar', true);
INSERT INTO calendar_events (id, team_id, connection_id, external_event_id, title, starts_at, team_meeting_key) VALUES
  ('a1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005', 'meeting', 'Legacy meeting', '2026-01-01', 'team:a1000000-0000-4000-8000-000000000002:start:2026-01-01:url:test'),
  ('a1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005', 'duplicate', 'Legacy in person meeting', '2026-01-02', 'team:a1000000-0000-4000-8000-000000000002:start:2026-01-02:location:test');
INSERT INTO meetings (id, team_id, owner_user_id, calendar_event_id, title, platform, status, team_meeting_key) VALUES
  ('a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000006', 'Legacy meeting', 'google_meet', 'missed', 'team:a1000000-0000-4000-8000-000000000002:start:2026-01-01:url:test'),
  ('a1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000007', 'Legacy in person meeting', 'in_person', 'missed', 'team:a1000000-0000-4000-8000-000000000002:start:2026-01-02:location:test'),
  ('a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', NULL, 'Company in person meeting', 'in_person', 'scheduled', 'team:a1000000-0000-4000-8000-000000000001:start:2026-01-02:location:test');
INSERT INTO meeting_notes (meeting_id, user_id, content)
VALUES ('a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000003', 'Private migration notes');

\ir ../db/migrations/0055_consolidate_legacy_iosf_calendar.sql
\ir ../db/migrations/0055_consolidate_legacy_iosf_calendar.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM meetings WHERE id IN ('a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000009') AND team_id = 'a1000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'Historical meeting IDs were not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM meetings WHERE id = 'a1000000-0000-4000-8000-000000000009' AND calendar_event_id = 'a1000000-0000-4000-8000-000000000007' AND team_meeting_key IS NULL) THEN
    RAISE EXCEPTION 'Historical duplicate lost its calendar reference';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM calendar_connections WHERE id = 'a1000000-0000-4000-8000-000000000005' AND team_id = 'a1000000-0000-4000-8000-000000000001' AND recall_calendar_id = 'migration-test-calendar') THEN
    RAISE EXCEPTION 'Calendar identity was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_memberships WHERE team_id = 'a1000000-0000-4000-8000-000000000001' AND user_id = 'a1000000-0000-4000-8000-000000000003' AND role = 'admin') THEN
    RAISE EXCEPTION 'Legacy owner lost administration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM team_meeting_bot_profiles WHERE team_id = 'a1000000-0000-4000-8000-000000000001' AND domain = 'iosg.vc' AND avatar_jpeg_base64 = 'original-avatar') THEN
    RAISE EXCEPTION 'Existing bot artwork changed';
  END IF;
END $$;

SET LOCAL ROLE tape_authenticated;
SELECT set_config('request.jwt.claims', '{"app_context_trusted":true,"sub":"iosf-migration-owner","email":"migration.owner@iosf.vc","app_user_id":"a1000000-0000-4000-8000-000000000003","app_team_id":"a1000000-0000-4000-8000-000000000001"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM meeting_notes WHERE content = 'Private migration notes') <> 1 THEN
    RAISE EXCEPTION 'Owner lost access to personal notes';
  END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"app_context_trusted":true,"sub":"iosg-migration-admin","email":"migration.admin@iosg.vc","app_user_id":"a1000000-0000-4000-8000-000000000004","app_team_id":"a1000000-0000-4000-8000-000000000001"}', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM meeting_notes WHERE content = 'Private migration notes') THEN
    RAISE EXCEPTION 'Private notes became visible to another administrator';
  END IF;
END $$;
ROLLBACK;
