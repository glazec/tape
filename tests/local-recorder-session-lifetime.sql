\set ON_ERROR_STOP on
BEGIN;
INSERT INTO teams (id, name) VALUES ('b0640000-0000-4000-8000-000000000001', 'Desktop session test');
INSERT INTO users (id, auth_user_id, email) VALUES
  ('b0640000-0000-4000-8000-000000000002', 'desktop-session-test', 'desktop-session@example.test');
INSERT INTO local_recorder_device_sessions
  (team_id, user_id, device_id_hash, token_hash, created_at, expires_at, revoked_at)
SELECT 'b0640000-0000-4000-8000-000000000001', 'b0640000-0000-4000-8000-000000000002',
  'device-test', token, created, expires, revoked
FROM (VALUES
  ('active-test', now() - interval '10 days', now() + interval '20 days', NULL::timestamptz),
  ('expired-test', now() - interval '31 days', now() - interval '1 day', NULL::timestamptz),
  ('revoked-test', now() - interval '10 days', now() + interval '20 days', now()),
  ('longer-test', now() - interval '10 days', now() + interval '200 days', NULL::timestamptz)
) AS fixtures(token, created, expires, revoked);

\ir ../db/migrations/0064_desktop_session_lifetime.sql
\ir ../db/migrations/0064_desktop_session_lifetime.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM local_recorder_device_sessions WHERE token_hash = 'active-test'
    AND device_id_hash = 'device-test' AND expires_at = created_at + interval '180 days'
    AND created_at = now() - interval '10 days' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Active session identity or lifetime was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM local_recorder_device_sessions WHERE token_hash = 'expired-test'
    AND expires_at = now() - interval '1 day') THEN
    RAISE EXCEPTION 'Expired session was revived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM local_recorder_device_sessions WHERE token_hash = 'revoked-test'
    AND expires_at = now() + interval '20 days' AND revoked_at = now()) THEN
    RAISE EXCEPTION 'Revoked session was changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM local_recorder_device_sessions WHERE token_hash = 'longer-test'
    AND expires_at = now() + interval '200 days') THEN
    RAISE EXCEPTION 'Longer session was shortened';
  END IF;
END $$;
ROLLBACK;
