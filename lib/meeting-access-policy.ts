import { eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import {
  meetingAccess,
  meetings,
  teamMemberships,
} from "@/db/schema";
import type { WorkspaceContext } from "@/lib/workspace";

const meetingManagerRoles = ["admin", "owner"];

export function getPersonalReadableMeetingsCondition(
  workspace: WorkspaceContext,
): SQL {
  return or(
    eq(meetings.ownerUserId, workspace.userId),
    getActiveGrantCondition(workspace),
  )!;
}

export function getReadableMeetingsCondition(
  workspace: WorkspaceContext,
): SQL {
  const teamManagerCondition = sql`exists (
    select 1
    from ${teamMemberships}
    where ${teamMemberships.teamId} = ${meetings.teamId}
      and ${teamMemberships.userId} = ${workspace.userId}
      and ${inArray(teamMemberships.role, meetingManagerRoles)}
  )`;
  return or(
    eq(meetings.ownerUserId, workspace.userId),
    teamManagerCondition,
    getActiveGrantCondition(workspace),
  )!;
}

export function getMeetingAccessScope(canManage: boolean) {
  return canManage ? "workspace" : "shared";
}

function getActiveGrantCondition(workspace: WorkspaceContext): SQL {
  return sql`exists (
    select 1
    from ${meetingAccess}
    where ${meetingAccess.meetingId} = ${meetings.id}
      and ${meetingAccess.userId} = ${workspace.userId}
      and ${isNull(meetingAccess.revokedAt)}
  )`;
}
