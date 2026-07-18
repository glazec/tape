import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import {
  meetingAccess,
  meetings,
  teamMemberships,
} from "@/db/schema";
import type { WorkspaceContext } from "@/lib/workspace";

const meetingManagerRoles = ["admin", "owner"];

export function getReadableMeetingsCondition(
  workspace: WorkspaceContext,
): SQL {
  const activeGrantCondition = sql`exists (
    select 1
    from ${meetingAccess}
    where ${meetingAccess.meetingId} = ${meetings.id}
      and ${meetingAccess.userId} = ${workspace.userId}
      and ${isNull(meetingAccess.revokedAt)}
  )`;
  const teamManagerCondition = sql`exists (
    select 1
    from ${teamMemberships}
    where ${teamMemberships.teamId} = ${meetings.teamId}
      and ${teamMemberships.userId} = ${workspace.userId}
      and ${inArray(teamMemberships.role, meetingManagerRoles)}
  )`;
  const organizationMemberCondition = sql`exists (
    select 1
    from ${teamMemberships}
    where ${teamMemberships.teamId} = ${meetings.teamId}
      and ${teamMemberships.userId} = ${workspace.userId}
      and ${ne(teamMemberships.role, "external")}
  )`;

  return or(
    eq(meetings.ownerUserId, workspace.userId),
    teamManagerCondition,
    and(
      eq(meetings.organizationAccessEnabled, true),
      organizationMemberCondition,
    ),
    activeGrantCondition,
  )!;
}

export function getMeetingAccessScope(canManage: boolean) {
  return canManage ? "workspace" : "shared";
}
