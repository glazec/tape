import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetingLibraryViews } from "@/db/schema";
import {
  defaultMeetingLibraryViewConfig,
  normalizeMeetingLibraryViewConfig,
  type MeetingLibraryViewConfig,
} from "@/lib/meeting-library-view-options";
import type { WorkspaceContext } from "@/lib/workspace";

export async function getDefaultMeetingLibraryView(
  workspace: WorkspaceContext,
): Promise<MeetingLibraryViewConfig | null> {
  const rows = await db
    .select({
      query: meetingLibraryViews.query,
      searchScope: meetingLibraryViews.searchScope,
      status: meetingLibraryViews.status,
      sort: meetingLibraryViews.sort,
    })
    .from(meetingLibraryViews)
    .where(
      and(
        eq(meetingLibraryViews.teamId, workspace.teamId),
        eq(meetingLibraryViews.userId, workspace.userId),
        eq(meetingLibraryViews.isDefault, true),
      ),
    )
    .limit(1);
  const view = rows[0];

  if (!view) {
    return null;
  }

  return normalizeMeetingLibraryViewConfig({
    q: view.query,
    scope: view.searchScope,
    status: view.status,
    sort: view.sort,
  });
}

export async function saveDefaultMeetingLibraryView({
  config,
  workspace,
}: {
  config: MeetingLibraryViewConfig;
  workspace: WorkspaceContext;
}) {
  const normalizedConfig = {
    ...defaultMeetingLibraryViewConfig,
    ...config,
  };

  await db
    .insert(meetingLibraryViews)
    .values({
      teamId: workspace.teamId,
      userId: workspace.userId,
      name: "My view",
      isDefault: true,
      query: normalizedConfig.query,
      searchScope: normalizedConfig.searchScope,
      status: normalizedConfig.status,
      sort: normalizedConfig.sort,
    })
    .onConflictDoUpdate({
      target: [
        meetingLibraryViews.userId,
        meetingLibraryViews.teamId,
        meetingLibraryViews.isDefault,
      ],
      set: {
        query: normalizedConfig.query,
        searchScope: normalizedConfig.searchScope,
        status: normalizedConfig.status,
        sort: normalizedConfig.sort,
        updatedAt: new Date(),
      },
    });
}
