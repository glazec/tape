-- Per-meeting transcript statistics for the dashboard weekly summary.
--
-- The dashboard read every current transcript segment of the caller's recent
-- meetings through tenant RLS and called app_private.speaker_name() twice per
-- segment. Each speaker_name() call repeats the meeting read check, so a user
-- with about 12,000 recent segments waited around 20 seconds. This helper
-- checks meeting access once per meeting and resolves each speaker name once,
-- then aggregates the segments with plain predicates.
--
-- Access matches the previous query: only meetings with the given team and
-- owner that the current claims can read (app_private.can_read_meeting), and
-- a speaker name only when the speaker's own meeting is readable, as
-- app_private.speaker_name() requires.
create or replace function app_private.dashboard_meeting_segment_stats(
  target_team_id uuid,
  target_owner_user_id uuid,
  window_start timestamptz,
  window_end timestamptz,
  user_aliases text[]
)
returns table (
  meeting_id uuid,
  total_duration_ms integer,
  user_duration_ms integer,
  user_texts jsonb,
  max_end_ms integer,
  hard_emotion_score integer,
  chill_emotion_score integer,
  neutral_emotion_score integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with window_meetings as materialized (
    select meeting.id as meeting_id
    from public.meetings as meeting
    where meeting.team_id = target_team_id
      and meeting.owner_user_id = target_owner_user_id
      and meeting.status <> 'cancelled'
      and coalesce(meeting.started_at, meeting.created_at) >= window_start
      and coalesce(meeting.started_at, meeting.created_at) <= window_end
  ),
  readable as materialized (
    select window_meetings.meeting_id
    from window_meetings
    where app_private.can_read_meeting(window_meetings.meeting_id)
  ),
  latest_replace as (
    select distinct on (job.meeting_id)
      job.meeting_id,
      job.id,
      job.created_at,
      job.generation_id
    from public.transcript_jobs as job
    inner join readable using (meeting_id)
    where job.mode = 'replace'
    order by job.meeting_id, job.created_at desc, job.id desc
  ),
  current_jobs as (
    -- Same rules as activeTranscriptJobIdsSubquery plus status = 'completed'.
    select
      job.id,
      job.meeting_id
    from public.transcript_jobs as job
    inner join readable using (meeting_id)
    left join latest_replace as replacement
      on replacement.meeting_id = job.meeting_id
    where job.status = 'completed'
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
  segments as materialized (
    select
      segment.meeting_id,
      segment.meeting_speaker_id,
      segment.speaker,
      segment.text,
      segment.emotion_label,
      greatest(
        coalesce(segment.end_ms, segment.start_ms) - segment.start_ms,
        0
      ) as duration_ms,
      greatest(
        segment.start_ms,
        coalesce(segment.end_ms, segment.start_ms)
      ) as end_ms
    from public.transcript_segments as segment
    inner join current_jobs as job
      on job.id = segment.job_id
      and job.meeting_id = segment.meeting_id
  ),
  speaker_names as materialized (
    -- Same precedence and access rule as app_private.speaker_name().
    select
      speaker.id,
      coalesce(
        person.preferred_name,
        speaker.display_name,
        speaker.source_label
      ) as name
    from public.meeting_speakers as speaker
    left join public.workspace_people as person
      on person.id = speaker.person_id
    where speaker.id in (
        select segments.meeting_speaker_id from segments
      )
      and (
        speaker.meeting_id in (select readable.meeting_id from readable)
        or app_private.can_read_meeting(speaker.meeting_id)
      )
  ),
  labelled as (
    select
      segments.meeting_id,
      segments.text,
      segments.emotion_label,
      segments.duration_ms,
      segments.end_ms,
      lower(regexp_replace(btrim(coalesce(
        speaker_names.name,
        segments.speaker,
        ''
      )), '[[:space:]]+', ' ', 'g')) = any(user_aliases) as is_user
    from segments
    left join speaker_names
      on speaker_names.id = segments.meeting_speaker_id
  )
  select
    labelled.meeting_id,
    coalesce(sum(labelled.duration_ms), 0)::int,
    coalesce(sum(
      case when labelled.is_user then labelled.duration_ms else 0 end
    ), 0)::int,
    coalesce(
      jsonb_agg(labelled.text) filter (where labelled.is_user),
      '[]'::jsonb
    ),
    coalesce(max(labelled.end_ms), 0)::int,
    coalesce(sum(
      case when labelled.emotion_label = 'hard'
        then case when labelled.duration_ms > 0 then labelled.duration_ms else 1 end
        else 0
      end
    ), 0)::int,
    coalesce(sum(
      case when labelled.emotion_label = 'chill'
        then case when labelled.duration_ms > 0 then labelled.duration_ms else 1 end
        else 0
      end
    ), 0)::int,
    coalesce(sum(
      case when labelled.emotion_label = 'neutral'
        then case when labelled.duration_ms > 0 then labelled.duration_ms else 1 end
        else 0
      end
    ), 0)::int
  from labelled
  group by labelled.meeting_id
$$;

revoke all on function app_private.dashboard_meeting_segment_stats(uuid, uuid, timestamptz, timestamptz, text[])
  from public;
grant execute on function app_private.dashboard_meeting_segment_stats(uuid, uuid, timestamptz, timestamptz, text[])
  to tape_authenticated, tape_mcp;
