-- Run only against an isolated database with migrations applied.
BEGIN;
INSERT INTO teams(id,name) VALUES ('10000000-0000-4000-8000-000000000001','Continuity test');
INSERT INTO users(id,auth_user_id,email) VALUES
 ('20000000-0000-4000-8000-000000000001','continuity-owner','owner@continuity.test'),
 ('20000000-0000-4000-8000-000000000002','continuity-reader','reader@continuity.test');
INSERT INTO team_memberships(team_id,user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','owner');
INSERT INTO meetings(id,team_id,owner_user_id,title,platform,status,recall_bot_id,bot_organization_domain) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Original','zoom','processing','old-bot','iosg.vc'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Pending source','zoom','processing','source-bot','iosf.vc'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Other owner','zoom','processing',null,null);
INSERT INTO recordings(id,meeting_id,source,external_bot_id,ended_at) VALUES
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','recall','source-bot',now()-interval '10 minutes');
INSERT INTO meeting_access(meeting_id,user_id,role) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','shared'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','shared');
SELECT set_config('request.jwt.claims','{"app_context_trusted":"true","app_user_id":"20000000-0000-4000-8000-000000000001","app_team_id":"10000000-0000-4000-8000-000000000001"}',true);
SET LOCAL ROLE tape_authenticated;
INSERT INTO meeting_parts(meeting_id,source_meeting_id,kind) VALUES
 ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','merge');
DO $$ BEGIN
  BEGIN
    INSERT INTO meeting_parts(meeting_id,source_meeting_id) VALUES
      ('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'reverse merge unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO meeting_parts(meeting_id,source_meeting_id) VALUES
      ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'different owner unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
DO $$ DECLARE first record; again record; BEGIN
  SELECT * INTO first FROM app_private.claim_meeting_continuation(
    '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','https://zoom.us/j/123','zoom','IOSF Old Friends');
  IF NOT first.claimed THEN RAISE EXCEPTION 'first continuation not claimed'; END IF;
  SELECT * INTO again FROM app_private.claim_meeting_continuation(
    '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','https://zoom.us/j/123','zoom','IOSF Old Friends');
  IF again.claimed OR first.source_id <> again.source_id THEN RAISE EXCEPTION 'duplicate continuation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM meeting_access_sources WHERE meeting_id=first.source_id AND recipient_email='reader@continuity.test' AND revoked_at IS NULL)
    THEN RAISE EXCEPTION 'continuation access is not durable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM meetings WHERE id=first.source_id AND bot_display_name='IOSF Old Friends' AND bot_organization_domain='iosf.vc')
    THEN RAISE EXCEPTION 'previous bot identity lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM meetings WHERE id='30000000-0000-4000-8000-000000000001' AND recall_bot_id='old-bot')
    THEN RAISE EXCEPTION 'old provider lineage overwritten'; END IF;
END $$;
UPDATE recordings SET ended_at=now()-interval '1 hour' WHERE id='40000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN
    PERFORM * FROM app_private.claim_meeting_continuation(
      '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','https://zoom.us/j/123','zoom','IOSF Old Friends');
    RAISE EXCEPTION 'expired continuation accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- A root share does not expose sources that the recipient cannot read.
RESET ROLE;
UPDATE meeting_access SET revoked_at=now() WHERE meeting_id<>'30000000-0000-4000-8000-000000000001' AND user_id='20000000-0000-4000-8000-000000000002';
SET LOCAL ROLE tape_authenticated;
SELECT set_config('request.jwt.claims','{"app_context_trusted":"true","app_user_id":"20000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM meeting_parts WHERE meeting_id='30000000-0000-4000-8000-000000000001')
    THEN RAISE EXCEPTION 'source metadata leaked'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
