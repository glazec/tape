create or replace function app_private.meeting_library_transcript_stats(
  target_meeting_ids uuid[]
)
returns table (
  meeting_id uuid,
  duration_ms integer,
  recognized_speaker_count integer,
  segment_count integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with requested_meetings as materialized (
    select distinct requested.meeting_id
    from unnest(
      coalesce(target_meeting_ids, array[]::uuid[])
    ) as requested(meeting_id)
    inner join app_private.readable_meeting_ids() as readable
      using (meeting_id)
  ),
  latest_replace as (
    select distinct on (job.meeting_id)
      job.meeting_id,
      job.id,
      job.created_at
    from public.transcript_jobs as job
    inner join requested_meetings as requested
      on requested.meeting_id = job.meeting_id
    where job.status = 'completed'
      and job.mode = 'replace'
    order by job.meeting_id, job.created_at desc, job.id desc
  ),
  current_jobs as (
    select
      job.id,
      job.meeting_id
    from public.transcript_jobs as job
    inner join requested_meetings as requested
      on requested.meeting_id = job.meeting_id
    left join latest_replace as replacement
      on replacement.meeting_id = job.meeting_id
    where job.status = 'completed'
      and (
        job.id = replacement.id
        or (
          job.mode = 'append'
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
  select
    segment.meeting_id,
    max(
      greatest(
        segment.start_ms,
        coalesce(segment.end_ms, segment.start_ms)
      )
    )::integer as duration_ms,
    count(
      distinct lower(btrim(segment.speaker))
    ) filter (
      where segment.speaker is not null
        and btrim(segment.speaker) <> ''
    )::integer as recognized_speaker_count,
    count(*)::integer as segment_count
  from public.transcript_segments as segment
  inner join current_jobs as job
    on job.id = segment.job_id
  group by segment.meeting_id
$$;

revoke all on function app_private.meeting_library_transcript_stats(uuid[])
  from public;
grant execute on function app_private.meeting_library_transcript_stats(uuid[])
  to tape_authenticated, tape_mcp;
