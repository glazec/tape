import { eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

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

  return or(
    eq(meetings.ownerUserId, workspace.userId),
    teamManagerCondition,
    activeGrantCondition,
  )!;
}

export function getMeetingAccessScope(canManage: boolean) {
  return canManage ? "workspace" : "shared";
}
