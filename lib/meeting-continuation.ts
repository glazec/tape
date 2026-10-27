import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { databaseSql, db } from "@/db/client";
import { meetingParts, meetings, recordings } from "@/db/schema";
import {
  requireManageableComposition,
  listReadableMeetingSources,
  MeetingCompositionError,
  isCompositionConflict,
} from "@/lib/meeting-composition";
import { getBotProfileForMeeting } from "@/lib/meeting-bot-record-profile";
import {
  getMeetingBotMetadata,
  getMeetingBotRecallCreateInput,
} from "@/lib/meeting-bot-profile";
import {
  buildAppUrl,
  detectBotSupportedMeetingPlatform,
  resolveMeetingJoinUrl,
} from "@/lib/meeting-links";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import {
  assertCanCreateMeetings,
  type WorkspaceContext,
} from "@/lib/workspace";
import {
  RecallBotSchedulingError,
  retrieveRecallBot,
  scheduleRecallBot,
} from "@/lib/vendors/recall";

export async function continueMeetingRecording(
  workspace: WorkspaceContext,
  meetingId: string,
  link: string,
) {
  await assertCanCreateMeetings(workspace);
  const target = await requireManageableComposition(workspace, meetingId);
  const platform = detectBotSupportedMeetingPlatform(link);
  if (!platform)
    throw new MeetingCompositionError("Enter a Zoom or Google Meet link.", 400);
  await assertWorkspaceHasProviderCredit(workspace);
  const sources = await listReadableMeetingSources(workspace, meetingId);
  const [latest] = await db
    .select({
      id: recordings.id,
      meetingId: recordings.meetingId,
      endedAt: recordings.endedAt,
      externalBotId: recordings.externalBotId,
    })
    .from(recordings)
    .where(
      and(
        inArray(recordings.meetingId, [meetingId, ...sources.map((s) => s.id)]),
        isNotNull(recordings.endedAt),
      ),
    )
    .orderBy(desc(recordings.endedAt), recordings.id)
    .limit(1);
  const now = Date.now();
  if (
    !latest?.endedAt ||
    latest.endedAt.getTime() > now ||
    now - latest.endedAt.getTime() >= 3_600_000
  ) {
    throw new MeetingCompositionError(
      "Continue recording is available for one hour after the recording ends.",
    );
  }
  const profile = await getBotProfileForMeeting(latest.meetingId);
  const [previous] = await db
    .select({
      botDisplayName: meetings.botDisplayName,
      recallBotId: meetings.recallBotId,
    })
    .from(meetings)
    .where(eq(meetings.id, latest.meetingId))
    .limit(1);
  // Older records predate the snapshot. Read the provider's actual name once;
  // failure leaves the operation unclaimed so it can be safely retried.
  const previousBotId = latest.externalBotId ?? previous?.recallBotId;
  if (!previous?.botDisplayName && previousBotId) {
    const bot = (await retrieveRecallBot(previousBotId)) as {
      bot_name?: unknown;
    };
    if (typeof bot.bot_name !== "string" || !bot.bot_name.trim()) {
      throw new MeetingCompositionError(
        "The previous bot name could not be confirmed. Try again.",
        502,
      );
    }
    profile.botName = bot.bot_name;
  }
  const meetingUrl = await resolveMeetingJoinUrl(link);
  let claim: { source_id: string; claimed: boolean };
  try {
    const rows =
      await databaseSql`select * from app_private.claim_meeting_continuation(
      ${target.id}::uuid, ${latest.id}::uuid, ${meetingUrl}, ${platform}::meeting_platform, ${profile.botName})`;
    claim = rows[0] as typeof claim;
  } catch (error) {
    if (isCompositionConflict(error))
      throw new MeetingCompositionError(
        "This recording can no longer be continued. Refresh the meeting.",
      );
    throw error;
  }
  if (!claim.claimed) {
    const [existing] = await db
      .select({ recallBotId: meetings.recallBotId })
      .from(meetings)
      .where(eq(meetings.id, claim.source_id))
      .limit(1);
    if (existing?.recallBotId) return { meetingId, status: "joining" as const };
    throw new MeetingCompositionError(
      "The previous join request is still being confirmed. Refresh shortly.",
    );
  }
  try {
    const bot = (await scheduleRecallBot({
      meetingUrl,
      ...getMeetingBotRecallCreateInput(profile),
      webhookUrl: buildAppUrl("/api/recall/webhook"),
      metadata: {
        ...getMeetingBotMetadata(profile),
        meetingId: claim.source_id,
      },
    })) as { id?: unknown };
    if (typeof bot.id !== "string" || !bot.id)
      throw new Error("Bot response did not include an ID");
    // Do not reset status: a provider callback may already have started recording.
    await db
      .update(meetings)
      .set({ recallBotId: bot.id, updatedAt: new Date() })
      .where(eq(meetings.id, claim.source_id));
    await db
      .update(meetingParts)
      .set({ dispatchState: "sent", updatedAt: new Date() })
      .where(eq(meetingParts.sourceMeetingId, claim.source_id));
    return { meetingId, status: "joining" as const };
  } catch (error) {
    // Only an explicit provider refusal is safe to retry. Network errors can
    // arrive after acceptance; keep the claim for webhook reconciliation.
    if (error instanceof RecallBotSchedulingError && error.status < 500) {
      await databaseSql.transaction((tx) => [
        tx`update meetings set status='failed', updated_at=now() where id=${claim.source_id}::uuid and recall_bot_id is null`,
        tx`update meeting_parts set dispatch_state='failed', updated_at=now() where source_meeting_id=${claim.source_id}::uuid
           and exists (select 1 from meetings where id=${claim.source_id}::uuid and recall_bot_id is null)`,
      ]);
      throw new MeetingCompositionError(
        "The bot could not join. Check the link and try again.",
        502,
      );
    }
    throw new MeetingCompositionError(
      "The join request is still being confirmed. Refresh shortly before trying again.",
      502,
    );
  }
}
