-- Meeting library search over participant and transcript rows.
--
-- Searching these child tables through tenant RLS evaluated
-- app_private.can_write_meeting() and the readable-meeting check for every
-- row, and app_private.speaker_name() for every transcript segment. That made
-- a single dashboard search take minutes. This helper resolves the readable
-- meetings once, then matches rows with plain predicates. Callers still apply
-- their own meeting filters; this function only narrows to meetings the
-- current claims can read.
create or replace function app_private.meeting_library_search_matches(
  search_pattern text,
  search_participants boolean,
  search_transcript boolean
)
returns table (
  meeting_id uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with readable as materialized (
    select readable.meeting_id
    from app_private.readable_meeting_ids() as readable
  ),
  participant_matches as (
    select attendee.meeting_id
    from public.meeting_attendees as attendee
    inner join readable using (meeting_id)
    where search_participants
      and attendee.email ilike search_pattern
    union
    select timeline.meeting_id
    from public.meeting_participant_timeline as timeline
    inner join readable using (meeting_id)
    where search_participants
      and (
        timeline.name ilike search_pattern
        or timeline.email ilike search_pattern
      )
  ),
  latest_replace as (
    select distinct on (job.meeting_id)
      job.meeting_id,
      job.id,
      job.created_at,
      job.generation_id
    from public.transcript_jobs as job
    inner join readable using (meeting_id)
    where search_transcript
      and job.mode = 'replace'
    order by job.meeting_id, job.created_at desc, job.id desc
  ),
  current_jobs as (
    select
      job.id,
      job.meeting_id
    from public.transcript_jobs as job
    inner join readable using (meeting_id)
    left join latest_replace as replacement
      on replacement.meeting_id = job.meeting_id
    where search_transcript
      and job.status = 'completed'
      and (
        job.id = replacement.id
        or (
          job.mode = 'append'
          and (
            job.generation_id = replacement.generation_id
            or (
              job.generation_id is null
              and (
                replacement.id is null
                or job.created_at > replacement.created_at
                or (
                  job.created_at = replacement.created_at
                  and job.id > replacement.id
                )
              )
            )
          )
        )
      )
  ),
  matching_speakers as materialized (
    -- Same precedence as app_private.speaker_name().
    select speaker.id
    from public.meeting_speakers as speaker
    inner join readable using (meeting_id)
    left join public.workspace_people as person
      on person.id = speaker.person_id
    where search_transcript
      and coalesce(
        person.preferred_name,
        speaker.display_name,
        speaker.source_label
      ) ilike search_pattern
  ),
  transcript_matches as (
    select segment.meeting_id
    from public.transcript_segments as segment
    inner join current_jobs as job
      on job.id = segment.job_id
      and job.meeting_id = segment.meeting_id
    where segment.text ilike search_pattern
      or segment.translated_text ilike search_pattern
      or segment.speaker ilike search_pattern
      or segment.meeting_speaker_id in (
        select matching_speakers.id from matching_speakers
      )
  )
  select participant_matches.meeting_id from participant_matches
  union
  select transcript_matches.meeting_id from transcript_matches
$$;

revoke all on function app_private.meeting_library_search_matches(text, boolean, boolean)
  from public;
grant execute on function app_private.meeting_library_search_matches(text, boolean, boolean)
  to tape_authenticated, tape_mcp;
