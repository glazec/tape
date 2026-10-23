DO $$
DECLARE
  company_team_id uuid;
  iosf_team_id uuid;
  existing_bot_name text;
  existing_avatar text;
BEGIN
  SELECT team_id INTO company_team_id
  FROM allowed_domains
  WHERE domain = 'iosg.vc';

  -- Other installations may not have this company configured.
  IF company_team_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO allowed_domains (team_id, domain)
  VALUES (company_team_id, 'iosf.vc')
  ON CONFLICT (domain) DO NOTHING;

  SELECT team_id INTO iosf_team_id
  FROM allowed_domains
  WHERE domain = 'iosf.vc';

  IF iosf_team_id IS DISTINCT FROM company_team_id THEN
    RAISE EXCEPTION 'iosf.vc already belongs to another workspace; refusing to merge existing workspaces';
  END IF;

  SELECT bot_name, avatar_jpeg_base64 INTO existing_bot_name, existing_avatar
  FROM team_meeting_bot_profiles
  WHERE team_id = company_team_id AND domain = '';

  INSERT INTO team_meeting_bot_profiles (
    team_id, domain, bot_name, avatar_jpeg_base64
  ) VALUES (
    company_team_id, 'iosg.vc',
    coalesce(existing_bot_name, 'IOSG Old Friend'), existing_avatar
  )
  ON CONFLICT (team_id, domain) DO NOTHING;

  INSERT INTO team_meeting_bot_profiles (team_id, domain, bot_name)
  VALUES (company_team_id, 'iosf.vc', 'IOSF Old Friend')
  ON CONFLICT (team_id, domain) DO NOTHING;

  UPDATE teams
  SET preferred_bot_domain = 'iosf.vc', updated_at = now()
  WHERE id = company_team_id;
END
$$;
