-- Run on a disposable database after 0069 and before 0070. All fixtures and DDL roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE identity_backfill_fixture AS SELECT gen_random_uuid() team,gen_random_uuid() actor,gen_random_uuid() meeting,gen_random_uuid() job1,gen_random_uuid() job2;
INSERT INTO teams(id,name) SELECT team,'Identity backfill' FROM identity_backfill_fixture;
INSERT INTO users(id,auth_user_id,email) SELECT actor,actor::text,'identity-backfill@example.test' FROM identity_backfill_fixture;
INSERT INTO team_memberships(team_id,user_id) SELECT team,actor FROM identity_backfill_fixture;
INSERT INTO meetings(id,team_id,owner_user_id,title,platform,ai_intel) SELECT meeting,team,actor,'Historical transcript','upload','{"sentinel":"unchanged"}'::jsonb FROM identity_backfill_fixture;
INSERT INTO transcript_jobs(id,meeting_id,status) SELECT job1,meeting,'completed'::job_status FROM identity_backfill_fixture UNION ALL SELECT job2,meeting,'completed'::job_status FROM identity_backfill_fixture;
INSERT INTO transcript_segments(meeting_id,job_id,speaker,start_ms,text)
SELECT meeting,job1,label,ordinal,'Historical ' || ordinal FROM identity_backfill_fixture CROSS JOIN (VALUES('Speaker 1',0),('Speaker 1',1),(NULL,2),('',3)) labels(label,ordinal)
UNION ALL SELECT meeting,job2,'Speaker 1',4,'Historical 4' FROM identity_backfill_fixture;
CREATE TEMP TABLE identity_original_segments AS SELECT id,meeting_id,job_id,speaker,start_ms,text FROM transcript_segments WHERE meeting_id=(SELECT meeting FROM identity_backfill_fixture);
\ir ../db/migrations/0070_speaker_person_identity.sql
DO $$
BEGIN
 IF EXISTS(SELECT id,meeting_id,job_id,speaker,start_ms,text FROM identity_original_segments EXCEPT SELECT id,meeting_id,job_id,speaker,start_ms,text FROM transcript_segments) THEN RAISE EXCEPTION 'Backfill changed historical source'; END IF;
 IF (SELECT count(DISTINCT meeting_speaker_id) FROM transcript_segments WHERE meeting_id=(SELECT meeting FROM identity_backfill_fixture))<>4 THEN RAISE EXCEPTION 'Backfill merged distinct job or null labels'; END IF;
 IF EXISTS(SELECT 1 FROM meeting_speakers WHERE meeting_id=(SELECT meeting FROM identity_backfill_fixture) AND person_id IS NOT NULL) THEN RAISE EXCEPTION 'Backfill inferred people'; END IF;
 IF EXISTS(SELECT 1 FROM transcript_segments WHERE meeting_id=(SELECT meeting FROM identity_backfill_fixture) AND meeting_speaker_id IS NULL) THEN RAISE EXCEPTION 'Backfill left segments unassigned'; END IF;
 IF NOT EXISTS(SELECT 1 FROM meetings WHERE id=(SELECT meeting FROM identity_backfill_fixture) AND attribution_revision=0 AND ai_intel='{"sentinel":"unchanged"}'::jsonb) THEN RAISE EXCEPTION 'Backfill invalidated stored generation'; END IF;
END $$;
ROLLBACK;
