import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { meetings, teamMemberships } from "@/db/schema";
import type { WorkspaceContext } from "@/lib/workspace";

const meetingManagerRoles = ["admin", "owner"];

export function getManageableMeetingCondition(
  workspace: WorkspaceContext,
  meetingId: string,
): SQL {
  return and(
    eq(meetings.id, meetingId),
    eq(meetings.teamId, workspace.teamId),
    getMeetingManagerCondition(workspace),
  )!;
}

export function getOwnedMeetingCondition(
  workspace: WorkspaceContext,
  meetingId: string,
): SQL {
  return and(
    eq(meetings.id, meetingId),
    eq(meetings.teamId, workspace.teamId),
    eq(meetings.ownerUserId, workspace.userId),
  )!;
}

export function getMeetingManagerCondition(
  workspace: WorkspaceContext,
): SQL {
  return or(
    eq(meetings.ownerUserId, workspace.userId),
    sql`exists (
      select 1
      from ${teamMemberships}
      where ${teamMemberships.teamId} = ${meetings.teamId}
        and ${teamMemberships.userId} = ${workspace.userId}
        and ${inArray(teamMemberships.role, meetingManagerRoles)}
    )`,
  )!;
}
