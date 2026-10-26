import { databaseSql } from "@/db/client";
import type { ShareRecipient } from "@/lib/meeting-queries";
import type { WorkspaceContext } from "@/lib/workspace";

// These are suggestions only. Sharing still validates the recipient and meeting
// independently, and the tenant-aware connection applies the caller's RLS claims.
export async function listShareRecipientSuggestions(
  workspace: WorkspaceContext,
): Promise<ShareRecipient[]> {
  const rows = await databaseSql`
    with organizations as (
      select team.id, team.name
      from team_memberships mine
      join teams team on team.id = mine.team_id
      where mine.user_id = ${workspace.userId}::uuid
        and mine.role <> 'external'
    ), candidates as (
      select lower(person.email) as email, person.name, org.name as organization
      from organizations org
      join team_memberships member on member.team_id = org.id
      join users person on person.id = member.user_id
      where member.role <> 'external'
        and member.user_id <> ${workspace.userId}::uuid
      union all
      select lower(trim(attendee.email)), null, org.name
      from organizations org
      join calendar_events event on event.team_id = org.id
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(event.attendee_emails) = 'array'
          then event.attendee_emails else '[]'::jsonb end
      ) attendee(email)
      join allowed_domains domain on domain.team_id = org.id
        and lower(domain.domain) = split_part(lower(trim(attendee.email)), '@', 2)
      union all
      select lower(recipient_email), null, null
      from meeting_share_policies
      where created_by_user_id = ${workspace.userId}::uuid
        and revoked_at is null
    )
    select email, max(name) as name,
      string_agg(distinct organization, ', ' order by organization) as organization
    from candidates
    where email <> (select lower(email) from users where id = ${workspace.userId}::uuid)
      and email like '%@%'
    group by email
    order by email
    limit 500
  `;
  return rows as ShareRecipient[];
}
