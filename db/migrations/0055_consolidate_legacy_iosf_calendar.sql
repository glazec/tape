DO $$
DECLARE
  company_team_id uuid;
  legacy_team_id uuid;
  settings_table text;
  has_settings boolean;
BEGIN
  SELECT team_id INTO company_team_id FROM allowed_domains WHERE domain = 'iosg.vc';
  IF company_team_id IS NULL THEN RETURN; END IF;

  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE calendar_connections, calendar_events, meetings, team_memberships
    IN SHARE ROW EXCLUSIVE MODE;

  FOR legacy_team_id IN
    SELECT DISTINCT connection.team_id
    FROM calendar_connections connection
    JOIN users owner ON owner.id = connection.user_id
    WHERE lower(split_part(owner.email, '@', 2)) = 'iosf.vc'
      AND connection.team_id <> company_team_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM team_memberships membership
      JOIN users member ON member.id = membership.user_id
      WHERE membership.team_id = legacy_team_id
        AND lower(split_part(member.email, '@', 2)) <> 'iosf.vc'
    ) OR EXISTS (
      SELECT 1 FROM calendar_connections connection
      JOIN users owner ON owner.id = connection.user_id
      WHERE connection.team_id = legacy_team_id
        AND lower(split_part(owner.email, '@', 2)) <> 'iosf.vc'
    ) OR EXISTS (
      SELECT 1 FROM allowed_domains
      WHERE team_id = legacy_team_id AND domain <> 'iosf.vc'
    ) THEN
      RAISE EXCEPTION 'Legacy IOSF workspace has another organization; refusing consolidation';
    END IF;

    -- Only the observed standalone calendar workspace is eligible. Retain
    -- richer workspaces for an explicit migration instead of dropping settings.
    FOREACH settings_table IN ARRAY ARRAY[
      'audit_events', 'local_recorder_device_sessions', 'local_recorder_devices',
      'meeting_library_views', 'meeting_share_policies', 'meeting_share_rules',
      'provider_usage_events', 'team_meeting_bot_profiles',
      'team_speaker_aliases', 'team_vocabulary_terms'
    ] LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE team_id = $1)', settings_table)
        INTO has_settings USING legacy_team_id;
      IF has_settings THEN
        RAISE EXCEPTION 'Legacy IOSF workspace has additional data in %; refusing consolidation', settings_table;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM meetings
      WHERE team_id = legacy_team_id
        AND status IN ('scheduled', 'recording', 'processing')
        AND recall_bot_id IS NOT NULL
    ) OR EXISTS (
      SELECT 1 FROM meetings legacy
      JOIN meetings company ON company.team_id = company_team_id
        AND company.team_meeting_key = regexp_replace(
          legacy.team_meeting_key, '^team:' || legacy_team_id::text || ':',
          'team:' || company_team_id::text || ':'
        )
      WHERE legacy.team_id = legacy_team_id
    ) THEN
      RAISE EXCEPTION 'Legacy IOSF workspace has active bots or duplicate meetings; refusing consolidation';
    END IF;

    INSERT INTO team_memberships (team_id, user_id, role)
    SELECT company_team_id, user_id, CASE WHEN role = 'owner' THEN 'admin' ELSE role END
    FROM team_memberships WHERE team_id = legacy_team_id
    ON CONFLICT (team_id, user_id) DO UPDATE
    SET role = CASE
      WHEN team_memberships.role = 'owner' THEN 'owner'
      WHEN team_memberships.role = 'admin' OR excluded.role = 'admin' THEN 'admin'
      WHEN team_memberships.role = 'member' OR excluded.role = 'member' THEN 'member'
      ELSE team_memberships.role
    END, updated_at = now();

    UPDATE calendar_connections SET team_id = company_team_id, updated_at = now()
    WHERE team_id = legacy_team_id;
    UPDATE calendar_events SET
      team_id = company_team_id,
      team_meeting_key = regexp_replace(team_meeting_key,
        '^team:' || legacy_team_id::text || ':', 'team:' || company_team_id::text || ':'),
      updated_at = now()
    WHERE team_id = legacy_team_id;
    UPDATE meetings SET
      team_id = company_team_id,
      team_meeting_key = regexp_replace(team_meeting_key,
        '^team:' || legacy_team_id::text || ':', 'team:' || company_team_id::text || ':'),
      updated_at = now()
    WHERE team_id = legacy_team_id;

    DELETE FROM team_memberships WHERE team_id = legacy_team_id;
  END LOOP;
END
$$;
