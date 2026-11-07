import { z } from "zod";
import { getOrTranslateFollowupCopy } from "@/lib/meeting-followup-translation";
import { inngest } from "@/inngest/client";
import { getUserLanguage } from "@/lib/user-language";
import { getTeamConfiguration } from "@/lib/team-configuration";
import { getCurrentMeetingFollowup, getConnectionsRevision, getCurrentMeetingConnectionIds, getFollowupSourceHash, storedFollowupSchema, resolveTranslatedFollowupSubjects } from "@/lib/meeting-followup-source";

import { getCurrentUser } from "@/lib/auth";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { generateAndSaveMeetingFollowup } from "@/lib/meeting-followup-generation";
import { assertWorkspaceHasProviderCredit, providerCreditErrorResponse } from "@/lib/provider-credit";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 150;
const requestSchema = z.strictObject({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meeting = await getComposedMeetingForFollowup(workspace, meetingId);
  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid followup request" },
      { status: 400 },
    );
  try {
    const existing = getCurrentMeetingFollowup(meeting);
    if (!existing && !meeting.canManage) return Response.json({ error: "Meeting not found" }, { status: 404 });
    const team = await getTeamConfiguration(workspace.teamId);
    const language = await getUserLanguage(workspace.userId, team.translationLanguage);
    const outcome = existing ? { status: "saved" as const, result: existing, connectionsRevision: getConnectionsRevision(meeting), connectionIds: getCurrentMeetingConnectionIds(meeting) } : await generateAndSaveMeetingFollowup({
      expectedSourceHash: parsed.data.sourceHash,
      meeting,
      meetingId,
      workspace,
    });

    switch (outcome.status) {
      case "saved": {
        if (!meeting.canManage && language !== "en") {
          if (parsed.data.sourceHash !== getFollowupSourceHash(meeting)) return Response.json({ error: "The meeting changed." }, { status: 409 });
          const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
          const copy = saved.success && saved.data.translations?.[language];
          if (copy) return Response.json({ ...outcome, result: resolveTranslatedFollowupSubjects(copy, outcome.result), language }, { headers: { "Cache-Control": "private, no-store" } });
          await assertWorkspaceHasProviderCredit(workspace);
          await inngest.send({
            id: `followup-copy:${meetingId}:${outcome.connectionsRevision}:${language}:${Math.floor(Date.now() / 60_000)}`,
            name: "meeting/translate.followup",
            data: { meetingId, workspace: { userId: workspace.userId, teamId: workspace.teamId, domain: workspace.domain }, language, sourceHash: parsed.data.sourceHash },
          });
          return Response.json({ pending: true }, { status: 202 });
        }
        const result = await getOrTranslateFollowupCopy(workspace, meetingId, language, parsed.data.sourceHash);
        if (result === "in_progress") return Response.json({ pending: true }, { status: 202 });
        if (!result) return Response.json({ error: "The meeting changed. Refresh and try again." }, { status: 409 });
        return Response.json(
          { result, language, connectionsRevision: outcome.connectionsRevision, connectionIds: outcome.connectionIds },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      case "in_progress":
        return Response.json({ pending: true }, { status: 202 });
      case "not_found":
        return Response.json({ error: "Meeting not found" }, { status: 404 });
      case "too_long":
        return Response.json(
          { error: "This transcript is too long to generate a followup." },
          { status: 422 },
        );
      case "meeting_changed":
        return Response.json(
          { error: "The meeting changed. Refresh the meeting and try again." },
          { status: 409 },
        );
      case "not_ready":
      case "transcript_changed":
        return Response.json(
          { error: "The transcript changed. Refresh the meeting and try again." },
          { status: 409 },
        );
    }
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);
    if (creditResponse) return creditResponse;
    console.error("meeting_followup_generation_failed", {
      meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Could not generate the followup. Please try again." },
      { status: 502 },
    );
  }
}
