import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MeetingAutoRefresh } from "@/components/meeting-auto-refresh";
import { MeetingBotRecoveryPanel } from "@/components/meeting-bot-recovery-panel";
import { MeetingActions } from "@/components/meeting-actions";
import { MeetingEntityLinks } from "@/components/meeting-entity-links";
import { MeetingHeaderMetadata } from "@/components/meeting-header-metadata";
import { MeetingRecoveryUploadPanel } from "@/components/meeting-recovery-upload-panel";
import { MeetingRecordingResume } from "@/components/meeting-recording-resume";
import { MeetingTitleEditor } from "@/components/meeting-title-editor";
import { RelatedMeetingsCard } from "@/components/related-meetings-card";
import { ShareDialog } from "@/components/share-dialog";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { requireCurrentUser } from "@/lib/auth-guards";
import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";
import {
  isMeetingBotRecoveryEligible,
  isMeetingRecordingResumeEligible,
} from "@/lib/meeting-bot-recovery-policy";
import { listActiveMeetingShares } from "@/lib/meeting-share-service";
import {
  getMeetingTranscriptForWorkspace,
  listMeetingDetailRelatedMeetingsForWorkspace,
  listWorkspaceShareRecipients,
} from "@/lib/meeting-queries";
import { moveRecordingTimestampToAppendedTimeline } from "@/lib/meeting-recording-timeline";
import { getTeamConfiguration } from "@/lib/team-configuration";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const [user, { meetingId }] = await Promise.all([
    requireCurrentUser(),
    params,
  ]);
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const [meeting, relatedMeetings] = await Promise.all([
    getMeetingTranscriptForWorkspace(workspace, meetingId),
    listMeetingDetailRelatedMeetingsForWorkspace(workspace, meetingId),
  ]);

  if (!meeting) {
    notFound();
  }

  const canManage = meeting.canManage;
  const canShare = meeting.segments.length > 0;
  const [shareRecipients, activeShares, teamConfiguration] = canShare
    ? await Promise.all([
        listWorkspaceShareRecipients(workspace),
        listActiveMeetingShares(meetingId),
        getTeamConfiguration(workspace.teamId),
      ])
    : [[], [], null];
  const displayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });
  const recordingParts = meeting.recordingParts ?? [];
  const continuousVisualAssets =
    recordingParts.length > 1
      ? meeting.visualAssets.map((asset) => ({
          ...asset,
          timestampMs:
            asset.timestampMs === null
              ? null
              : moveRecordingTimestampToAppendedTimeline(
                  recordingParts,
                  asset.timestampMs,
                ),
        }))
      : meeting.visualAssets;
  const shouldOfferBotRecovery = isMeetingBotRecoveryEligible({
    canManage,
    endedAt: meeting.endedAt,
    platform: meeting.platform,
    segmentCount: meeting.segments.length,
    startedAt: meeting.startedAt,
    status: displayStatus,
    updatedAt: meeting.updatedAt,
  });
  const shouldOfferRecordingResume = isMeetingRecordingResumeEligible({
    canManage,
    lastRecordingEndedAt: recordingParts.at(-1)?.endedAt ?? meeting.endedAt,
    platform: meeting.platform,
    scheduledEndedAt: meeting.scheduledEndedAt,
    scheduledStartedAt: meeting.scheduledStartedAt,
    status: displayStatus,
  });
  const shouldOfferLocalRecorderGuidance =
    canManage &&
    meeting.platform === "microsoft_teams" &&
    displayStatus === "scheduled";
  const canAddMeetingSource =
    displayStatus === "failed" ||
    displayStatus === "missed" ||
    (meeting.platform === "in_person" && displayStatus === "scheduled") ||
    shouldOfferLocalRecorderGuidance;
  const shouldCenterMeetingSource =
    canManage &&
    (canAddMeetingSource || shouldOfferBotRecovery) &&
    meeting.segments.length === 0;
  return (
    <AppShell
      activeHref="/dashboard"
      amplitudeTeamId={workspace.teamId}
      canCreateMeetings={workspace.canCreateMeetings !== false}
      oneSignalExternalId={workspace.userId}
    >
      <div
        className={`grid min-w-0 gap-8 ${
          shouldCenterMeetingSource
            ? "lg:grid-cols-1"
            : "lg:grid-cols-[1fr_20rem] lg:grid-rows-[auto_1fr]"
        }`}
      >
        <section className="min-w-0">
          <MeetingAutoRefresh
            meetingStatus={meeting.status}
            segmentCount={meeting.segments.length}
            transcriptJobStatus={meeting.transcriptJobStatus}
            translationStatus={meeting.translationSummary.status}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Meeting
            </p>
            {canManage ? (
              <MeetingActions
                audioExportUrls={
                  recordingParts.length > 1
                    ? recordingParts.map(
                        (part) =>
                          `/api/meetings/${encodeURIComponent(
                            meetingId,
                          )}/audio?recording=${encodeURIComponent(
                            part.id,
                          )}&download=1`,
                      )
                    : undefined
                }
                canDelete={meeting.canDelete}
                hasAudio={
                  Boolean(meeting.audioUrl) || recordingParts.length > 0
                }
                hasTranscript={meeting.segments.length > 0}
                imageCount={meeting.visualAssets.length}
                instanceId="header"
                meetingId={meetingId}
              />
            ) : null}
          </div>
          <div className="mt-2 min-w-0">
            {canManage ? (
              <MeetingTitleEditor
                meetingId={meetingId}
                meetingTitle={meeting.title}
              />
            ) : (
              <h1 className="break-words text-3xl font-semibold tracking-tight">
                {meeting.title}
              </h1>
            )}
          </div>
          <MeetingHeaderMetadata
            durationMs={meeting.durationMs}
            endedAt={meeting.endedAt}
            platform={formatPlatform(meeting.platform)}
            startedAt={meeting.startedAt}
            status={formatStatus(displayStatus)}
          />
        </section>

        <section
          className={`min-w-0 ${
            shouldCenterMeetingSource ? "" : "lg:col-start-1 lg:row-start-2"
          }`}
        >
          <div>
            {shouldCenterMeetingSource ? (
              <div className="mx-auto w-full max-w-2xl py-2 sm:py-6">
                {shouldOfferLocalRecorderGuidance ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-muted/25 p-5">
                      <h2 className="text-base font-semibold">
                        Record this Teams meeting locally
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Open Tape for Mac. This meeting appears in Pending
                        meetings during its recording window, and the app sends
                        a notification when local capture becomes available.
                      </p>
                    </div>
                    <details className="rounded-lg border bg-muted/20 p-4">
                      <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        Already have a recording or transcript?
                      </summary>
                      <div className="mt-4">
                        <MeetingRecoveryUploadPanel meetingId={meetingId} />
                      </div>
                    </details>
                  </div>
                ) : shouldOfferBotRecovery ? (
                  <div className="space-y-4">
                    <MeetingBotRecoveryPanel
                      meetingId={meetingId}
                      meetingUrl={meeting.meetingUrl}
                    />
                    <details className="rounded-lg border bg-muted/20 p-4">
                      <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        Already have a recording or transcript?
                      </summary>
                      <div className="mt-4">
                        <MeetingRecoveryUploadPanel meetingId={meetingId} />
                      </div>
                    </details>
                  </div>
                ) : (
                  <MeetingRecoveryUploadPanel meetingId={meetingId} />
                )}
              </div>
            ) : (
              <>
                {shouldOfferRecordingResume && meeting.meetingUrl ? (
                  <MeetingRecordingResume
                    meetingId={meetingId}
                    meetingUrl={meeting.meetingUrl}
                  />
                ) : null}
                <TranscriptViewer
                  audioParts={
                    recordingParts.length > 1 ? recordingParts : undefined
                  }
                  audioUrl={meeting.audioUrl}
                  key={getTranscriptViewerRenderKey({
                    displayStatus,
                    meetingId,
                    polishedSegments: meeting.segments.filter((segment) =>
                      Boolean(segment.polishedText?.trim()),
                    ).length,
                    segmentCount: meeting.segments.length,
                    translatedSegments:
                      meeting.translationSummary.translatedSegments,
                    translationStatus: meeting.translationSummary.status,
                  })}
                  meetingId={canManage ? meetingId : null}
                  preferredTranslationLanguage={
                    teamConfiguration?.translationLanguage ??
                    meeting.translationLanguage
                  }
                  segments={meeting.segments}
                  speakerAliases={meeting.speakerAliases}
                  speakerSuggestions={meeting.speakerSuggestions}
                  translationLanguage={meeting.translationLanguage}
                  translationSummary={meeting.translationSummary}
                  visualAssets={continuousVisualAssets}
                />
                <MeetingEntityLinks entities={meeting.entities} />
              </>
            )}
          </div>
        </section>

        {shouldCenterMeetingSource ? (
          <aside className="mx-auto w-full max-w-2xl min-w-0">
            <RelatedMeetingsCard meetings={relatedMeetings} />
          </aside>
        ) : (
          <>
            <aside
              className={`min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 ${
                canShare ? "lg:pt-8" : "lg:pt-24"
              }`}
            >
              {canManage ? (
                <>
                  {canShare ? (
                    <div>
                      <ShareDialog
                        allowRelated
                        canRemoveAccess
                        customAudience={
                          teamConfiguration?.shareAudience
                            ? {
                                memberCount:
                                  teamConfiguration.shareAudience.emails.length,
                                name: teamConfiguration.shareAudience.name,
                              }
                            : null
                        }
                        initialAccessPeople={meeting.accessPeople}
                        initialShares={activeShares}
                        instanceId="meeting-sharing"
                        meetingId={meetingId}
                        teamMembers={shareRecipients}
                      />
                    </div>
                  ) : null}
                  {canAddMeetingSource ? (
                    <div className="mt-6">
                      <MeetingRecoveryUploadPanel meetingId={meetingId} />
                    </div>
                  ) : null}
                  <div className="hidden lg:mt-6 lg:block">
                    <RelatedMeetingsCard meetings={relatedMeetings} />
                  </div>
                </>
              ) : (
                <>
                  {canShare ? (
                    <ShareDialog
                      allowRelated={false}
                      canRemoveAccess={false}
                      customAudience={
                        teamConfiguration?.shareAudience
                          ? {
                              memberCount:
                                teamConfiguration.shareAudience.emails.length,
                              name: teamConfiguration.shareAudience.name,
                            }
                          : null
                      }
                      initialAccessPeople={meeting.accessPeople}
                      initialShares={activeShares}
                      instanceId="meeting-sharing"
                      meetingId={meetingId}
                      teamMembers={shareRecipients}
                    />
                  ) : null}
                  <div
                    className={`rounded-lg border bg-card p-5 ${
                      canShare ? "mt-6" : ""
                    }`}
                  >
                    <p className="text-sm font-semibold">Shared transcript</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      You can read and share this transcript. Editing stays with
                      the meeting owner.
                    </p>
                  </div>
                  <div className="hidden lg:mt-6 lg:block">
                    <RelatedMeetingsCard meetings={relatedMeetings} />
                  </div>
                </>
              )}
            </aside>

            <aside className="min-w-0 lg:hidden">
              <RelatedMeetingsCard meetings={relatedMeetings} />
            </aside>
          </>
        )}
      </div>
    </AppShell>
  );
}

export function getTranscriptViewerRenderKey({
  displayStatus,
  meetingId,
  polishedSegments,
  segmentCount,
  translatedSegments,
  translationStatus,
}: {
  displayStatus: string;
  meetingId: string;
  polishedSegments: number;
  segmentCount: number;
  translatedSegments: number;
  translationStatus?: string | null;
}) {
  return [
    meetingId,
    displayStatus,
    segmentCount,
    polishedSegments,
    translationStatus ?? "unknown",
    translatedSegments,
  ].join(":");
}

function formatPlatform(platform: string) {
  if (platform === "google_meet") {
    return "Google Meet";
  }

  if (platform === "in_person") {
    return "In person";
  }

  if (platform === "microsoft_teams") {
    return "Microsoft Teams";
  }

  if (platform === "zoom") {
    return "Zoom";
  }

  return "Upload";
}

function formatStatus(status: string) {
  if (status === "missed") {
    return "No recording";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}
