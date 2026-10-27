import Link from "next/link";
import { MeetingComposedTranscripts } from "@/components/meeting-composed-transcripts";
import { getMeetingCompositionForWorkspace, composeMeetingForFollowup } from "@/lib/meeting-composition";
import { listShareRecipientSuggestions } from "@/lib/share-recipient-suggestions";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MeetingAutoRefresh } from "@/components/meeting-auto-refresh";
import { MeetingBotRecoveryPanel } from "@/components/meeting-bot-recovery-panel";
import { MeetingActions } from "@/components/meeting-actions";
import { MeetingEntityLinks } from "@/components/meeting-entity-links";
import { MeetingHeaderMetadata } from "@/components/meeting-header-metadata";
import { MeetingNotes } from "@/components/meeting-notes";
import { MeetingFollowup } from "@/components/meeting-followup";
import { MeetingRecoveryUploadPanel } from "@/components/meeting-recovery-upload-panel";
import { MeetingRecordingResume } from "@/components/meeting-recording-resume";
import { MeetingTitleEditor } from "@/components/meeting-title-editor";
import { RelatedMeetingsCard } from "@/components/related-meetings-card";
import { ShareDialog } from "@/components/share-dialog";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { requireCurrentUser } from "@/lib/auth-guards";
import {
  getCurrentMeetingFollowup,
  getFollowupSourceHash,
  isFollowupReady,
} from "@/lib/meeting-followup-source";
import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";
import {
  isMeetingBotRecoveryEligible,
} from "@/lib/meeting-bot-recovery-policy";
import { listActiveMeetingShares } from "@/lib/meeting-share-service";
import { getTranscriptViewerRenderKey } from "@/lib/meeting-transcript-render-key";
import {
  listMeetingDetailRelatedMeetingsForWorkspace,
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
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const [composition, relatedMeetings] = await Promise.all([
    getMeetingCompositionForWorkspace(workspace, meetingId),
    listMeetingDetailRelatedMeetingsForWorkspace(workspace, meetingId),
  ]);

  if (!composition) {
    notFound();
  }

  const meeting = composition.primary;
  const parts = composition.parts;
  const isComposed = parts.length > 1;
  const followupMeeting = composeMeetingForFollowup(composition);
  const latestPart = [...parts].sort((a,b) => Date.parse(b.lastRecordingEndedAt ?? "1970-01-01") - Date.parse(a.lastRecordingEndedAt ?? "1970-01-01"))[0];
  const hasActivePart = parts.some(part => ["scheduled", "recording"].includes(part.status));
  const canManage = meeting.canManage;
  const participants = [...new Map(parts.flatMap(part => part.speakerSuggestions)
    .map(person => [person.email.trim().toLowerCase(), person])).values()];
  const followupResult = getCurrentMeetingFollowup(followupMeeting);
  const followupSourceHash = getFollowupSourceHash(followupMeeting);
  const canShare = parts.some(part => part.segments.length > 0);
  const [shareRecipients, activeShares, teamConfiguration] = canShare
    ? await Promise.all([
        listShareRecipientSuggestions(workspace),
        listActiveMeetingShares(meetingId),
        getTeamConfiguration(workspace.teamId),
      ])
    : [[], [], null];
  const primaryDisplayStatus = getMeetingDisplayStatus({
    meetingStatus: meeting.status,
    transcriptJobStatus: meeting.transcriptJobStatus,
  });
  const displayStatus = isComposed
    ? parts.some(part => part.status === "recording") ? "recording"
      : hasActivePart ? "scheduled"
      : parts.some(part => ["queued", "running"].includes(part.transcriptJobStatus ?? "") || part.status === "processing") ? "processing"
      : parts.some(part => part.status === "failed") ? "failed" : primaryDisplayStatus
    : primaryDisplayStatus;
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
  const shouldOfferBotRecovery = !meeting.lastRecordingEndedAt && isMeetingBotRecoveryEligible({
    canManage,
    endedAt: meeting.endedAt,
    platform: meeting.platform,
    segmentCount: meeting.segments.length,
    startedAt: meeting.startedAt,
    status: primaryDisplayStatus,
    updatedAt: meeting.updatedAt,
  });
  // Keep the component mounted when its deadline passes so an open dialog can
  // explain expiry. The client hides its trigger and the API enforces the cutoff.
  const shouldOfferRecordingResume = canManage && !composition.parent && !hasActivePart
    && ["processing", "ready", "failed"].includes(meeting.status)
    && ["google_meet", "zoom"].includes(latestPart.platform)
    && Boolean(latestPart.lastRecordingEndedAt);
  const shouldOfferLocalRecorderGuidance =
    canManage &&
    meeting.platform === "microsoft_teams" &&
    displayStatus === "scheduled";
  const canAddMeetingSource =
    primaryDisplayStatus === "failed" ||
    primaryDisplayStatus === "missed" ||
    (meeting.platform === "in_person" && displayStatus === "scheduled") ||
    shouldOfferLocalRecorderGuidance;
  const shouldCenterMeetingSource =
    !isComposed && canManage &&
    (canAddMeetingSource || shouldOfferBotRecovery) &&
    meeting.segments.length === 0;
  const renderShareDialog = (instanceId: string) =>
    canShare ? (
      <div>
      <ShareDialog
        allowRelated={canManage}
        canRemoveAccess={canManage}
        customAudience={
          teamConfiguration?.shareAudience
            ? {
                memberCount: teamConfiguration.shareAudience.emails.length,
                name: teamConfiguration.shareAudience.name,
              }
            : null
        }
        initialAccessPeople={meeting.accessPeople}
        initialShares={activeShares}
        instanceId={instanceId}
        meetingId={meetingId}
        teamMembers={shareRecipients}
      />
      {isComposed ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Sharing applies to this meeting. Recipients also need access to each original recording.</p> : null}
      </div>
    ) : null;
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
            <MeetingActions
              audioExportUrls={
                isComposed ? parts.flatMap(part => part.recordingParts.length > 1
                  ? part.recordingParts.map(recording => `/api/meetings/${part.id}/audio?recording=${recording.id}&download=1`)
                  : part.audioUrl ? [`/api/meetings/${part.id}/audio?download=1`] : []) : recordingParts.length > 1
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
              canMerge={canManage && !composition.parent}
              meetingTitle={meeting.title}
              canDelete={meeting.canDelete}
              canReplaceAudio={!isComposed && canManage && meeting.status === "ready"}
              hasAudio={
                parts.some(part => Boolean(part.audioUrl) || part.recordingParts.length > 0)
              }
              hasTranscript={parts.some(part => part.segments.length > 0)}
              imageCount={parts.reduce((sum, part) => sum + part.visualAssets.length, 0)}
              instanceId="header"
              meetingId={meetingId}
            />
          </div>
          {composition.parent ? <p className="mt-3 text-sm text-muted-foreground">Part of <Link className="underline underline-offset-4" href={`/meetings/${composition.parent.id}`}>{composition.parent.title}</Link></p> : null}
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
            durationMs={isComposed ? parts.every(part => part.durationMs !== null) ? parts.reduce((sum, part) => sum + (part.durationMs ?? 0), 0) : null : meeting.durationMs}
            endedAt={meeting.endedAt}
            platform={formatPlatform(meeting.platform)}
            startedAt={meeting.startedAt}
            status={displayStatus === "scheduled" && composition.sources.some(source => source.kind === "continuation" && source.status === "scheduled") ? "Waiting to join" : formatStatus(displayStatus)}
          />
          {participants.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Participants</span>
              <ul aria-label="Participants" className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {participants.map((participant) => (
                  <li className="break-all" key={participant.email} title={participant.email}>
                    {participant.name || participant.email}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section
          className={`min-w-0 ${
            shouldCenterMeetingSource ? "" : "lg:col-start-1 lg:row-start-2"
          }`}
        >
          <div>
            <MeetingNotes
              key={`${workspace.userId}:${meetingId}`}
              meetingId={meetingId}
              userId={workspace.userId}
            />
                {shouldOfferRecordingResume && latestPart.meetingUrl && latestPart.lastRecordingEndedAt ? (
                  <MeetingRecordingResume
                    meetingId={meetingId}
                    meetingUrl={latestPart.meetingUrl}
                    lastRecordingEndedAt={latestPart.lastRecordingEndedAt}
                  />
                ) : null}
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
                {isComposed ? <>
                  <p className="mb-5 text-sm text-muted-foreground">{parts.length} recordings. Each part keeps its original audio and sharing.</p>
                  <div className="mb-4 lg:hidden">{renderShareDialog("combined-sharing-mobile")}</div>
                  <MeetingComposedTranscripts meetings={parts} primaryMeetingId={meetingId} preferredTranslationLanguage={teamConfiguration?.translationLanguage} />
                </> : <TranscriptViewer
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
                  mobileAfterSpeakers={
                    <>
                      <MeetingEntityLinks entities={meeting.entities} />
                      {renderShareDialog("meeting-sharing-mobile")}
                    </>
                  }
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
                />}
                {isFollowupReady(followupMeeting) ? (
                  <MeetingFollowup
                    canGenerate={canManage}
                    initialResult={followupResult}
                    key={`${workspace.userId}:${meetingId}:${followupSourceHash}:${canManage}:${JSON.stringify(followupResult)}`}
                    meetingId={meetingId}
                    segments={followupMeeting.segments.map(({ id, startMs }) => ({ id, startMs }))}
                    sourceHash={followupSourceHash}
                  />
                ) : null}
                <div className="hidden lg:block">
                  <MeetingEntityLinks entities={meeting.entities} />
                </div>
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
                    <div className="hidden lg:block">
                      {renderShareDialog("meeting-sharing-desktop")}
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
                    <div className="hidden lg:block">
                      {renderShareDialog("meeting-sharing-desktop")}
                    </div>
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
