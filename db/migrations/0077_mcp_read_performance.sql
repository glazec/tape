-- Materialize readable meetings once for speaker RLS policies (matching 0043).
--
-- Migration 0070 used app_private.can_read_meeting(meeting_id) per row on
-- meeting_speakers and meeting_speaker_changes. Under MCP execute_meeting_sql
-- with Google OAuth claims, evaluating can_read_meeting() -> current_user_id()
-- per speaker row caused multi-second scans and 10s statement timeouts.
drop policy if exists speaker_read on public.meeting_speakers;
create policy speaker_read on public.meeting_speakers
  for select to tape_authenticated, tape_mcp
  using (meeting_id in (select readable.meeting_id from app_private.readable_meeting_ids() as readable));

drop policy if exists speaker_changes_read on public.meeting_speaker_changes;
create policy speaker_changes_read on public.meeting_speaker_changes
  for select to tape_authenticated, tape_mcp
  using (meeting_id in (select readable.meeting_id from app_private.readable_meeting_ids() as readable));
