import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { FOLLOWUP_SOURCE_LIMIT } from "@/lib/meeting-followup";
import {
  getFollowupSource,
  getFollowupSourceHash,
  isFollowupReady,
} from "@/lib/meeting-followup-source";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import {
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import { generateMeetingFollowup } from "@/lib/vendors/openrouter";
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
  if (!meeting?.canManage) {
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
  const source = getFollowupSource(meeting);
  const sourceHash = getFollowupSourceHash(source);
  if (!isFollowupReady(meeting) || sourceHash !== parsed.data.sourceHash) {
    return Response.json(
      { error: "The transcript changed. Refresh the meeting and try again." },
      { status: 409 },
    );
  }
  if (JSON.stringify(source).length > FOLLOWUP_SOURCE_LIMIT) {
    return Response.json(
      { error: "This transcript is too long to generate a followup." },
      { status: 422 },
    );
  }
  try {
    await assertWorkspaceHasProviderCredit(workspace);
    const result = await generateMeetingFollowup(source, meetingId);
    const current = await getComposedMeetingForFollowup(
      workspace,
      meetingId,
    );
    if (!current?.canManage)
      return Response.json({ error: "Meeting not found" }, { status: 404 });
    if (
      !isFollowupReady(current) ||
      getFollowupSourceHash(current) !== sourceHash
    ) {
      return Response.json(
        { error: "The transcript changed. Refresh the meeting and try again." },
        { status: 409 },
      );
    }
    const saved = await db
      .update(meetings)
      .set({ aiFollowup: { sourceHash, result } })
      .where(
        and(
          getManageableMeetingCondition(workspace, meetingId),
          eq(meetings.status, "ready"),
          eq(meetings.updatedAt, new Date(current.updatedAt)),
        ),
      )
      .returning({ id: meetings.id });
    if (!saved[0]) {
      return Response.json(
        { error: "The meeting changed. Refresh the meeting and try again." },
        { status: 409 },
      );
    }
    return Response.json(
      { result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);
    if (creditResponse) return creditResponse;
    return Response.json(
      { error: "Could not generate the followup. Please try again." },
      { status: 502 },
    );
  }
}
