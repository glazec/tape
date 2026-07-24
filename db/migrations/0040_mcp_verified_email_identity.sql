CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    CASE
      WHEN app_private.claim_text('app_context_trusted') = 'true'
        THEN app_private.claim_uuid('app_user_id')
      ELSE NULL
    END,
    (
      SELECT app_user.id
      FROM public.users AS app_user
      WHERE app_user.auth_user_id = app_private.claim_text('sub')
      LIMIT 1
    ),
    (
      SELECT app_user.id
      FROM public.users AS app_user
      WHERE lower(app_user.email) = app_private.claim_email()
      LIMIT 1
    )
  )
$$;
