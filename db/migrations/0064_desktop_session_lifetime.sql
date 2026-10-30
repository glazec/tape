-- Keep existing credentials and the original login date; never revive expired or revoked sessions.
UPDATE public.local_recorder_device_sessions
SET expires_at = created_at + interval '180 days', updated_at = now()
WHERE revoked_at IS NULL
  AND expires_at > now()
  AND expires_at < created_at + interval '180 days';
