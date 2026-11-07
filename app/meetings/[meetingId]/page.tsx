import Link from "next/link";
import { PersonLink } from "@/components/person-link";
import { findPeopleByEmail, isMeetingWorkspaceMember } from "@/lib/people";
import { MeetingComposedTranscripts } from "@/components/meeting-composed-transcripts";
import { getMeetingCompositionForWorkspace, composeMeetingForFollowup } from "@/lib/meeting-composition";
import { listShareRecipientSuggestions } from "@/lib/share-recipient-suggestions";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { MeetingAutoRefresh } from "@/components/meeting-auto-refresh";
import { MeetingBotRecoveryPanel } from "@/components/meeting-bot-recovery-panel";
import { MeetingActions } from "@/components/meeting-actions";
import { canReplaceMeetingLink } from "@/lib/meeting-link-replacement-policy";
import { MeetingEntityLinks } from "@/components/meeting-entity-links";
import { MeetingHeaderMetadata } from "@/components/meeting-header-metadata";
import { MeetingNotes } from "@/components/meeting-notes";
import { applyPreferredTranscriptLanguage } from "@/lib/preferred-transcript-language";
import { getUserLanguage } from "@/lib/user-language";
import { storedFollowupSchema, resolveTranslatedFollowupSubjects } from "@/lib/meeting-followup-source";
import { MeetingFollowup } from "@/components/meeting-followup";
import { MeetingRecoveryUploadPanel } from "@/components/meeting-recovery-upload-panel";
import { MeetingRecordingResume } from "@/components/meeting-recording-resume";
import { MeetingTitleEditor } from "@/components/meeting-title-editor";
import { MeetingViewTabs } from "@/components/meeting-view-tabs";
import { RelatedMeetingsCard } from "@/components/related-meetings-card";
import { MeetingShareButton } from "@/components/share-dialog";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { requireCurrentUser } from "@/lib/auth-guards";
import {
  getCurrentMeetingFollowup,
  getConnectionsRevision,
  getCurrentMeetingConnectionIds,
  getCurrentMeetingConnections,
  getFollowupSourceHash,
  getFollowupSource,
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
import { getOrganizationBotSettings } from "@/lib/organization-workspaces";
import { getTeamConfiguration } from "@/lib/team-configuration";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ meetingId: string }>;
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const [user, { meetingId }, query] = await Promise.all([
    requireCurrentUser(),
    params,
    searchParams ?? Promise.resolve<{ view?: string | string[] }>({}),
  ]);
  const initialView = query.view === "transcript" ? "transcript" : "notes";
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
  const followupSource = getFollowupSource(followupMeeting);
  const followupResult = getCurrentMeetingFollowup(followupMeeting);
  const followupSourceHash = getFollowupSourceHash(followupMeeting);
  // The transcript-complete job generates the followup shortly after a recording ends; give it
  // time before the page generates its own. Edits bump updatedAt, so key off the recording end.
  const recordingEndedAt = Date.parse(latestPart?.lastRecordingEndedAt ?? meeting.endedAt ?? "");
  const followupJobMayBeRunning = Number.isFinite(recordingEndedAt) && recordingEndedAt > new Date().getTime() - 20 * 60_000;
  const canShare = parts.some(part => part.segments.length > 0);
  const [{ domains: organizationDomains }, canOpenPeople] = await Promise.all([
    getOrganizationBotSettings(workspace.teamId),
    isMeetingWorkspaceMember(meetingId),
  ]);
  const participantPeople = canOpenPeople
    ? await findPeopleByEmail(workspace.teamId, participants.map(person => person.email))
    : new Map<string, string>();
  const [shareRecipients, activeShares, teamConfiguration] = canShare
    ? await Promise.all([
        listShareRecipientSuggestions(workspace),
        listActiveMeetingShares(meetingId),
        getTeamConfiguration(workspace.teamId),
      ])
    : [[], [], null];
  const preferredLanguage = await getUserLanguage(workspace.userId, teamConfiguration?.translationLanguage);
  const savedFollowup = storedFollowupSchema.safeParse(followupMeeting.aiFollowup);
  const cachedFollowup = followupResult && savedFollowup.success ? savedFollowup.data.translations?.[preferredLanguage] : undefined;
  const translatedFollowup = cachedFollowup && followupResult ? resolveTranslatedFollowupSubjects(cachedFollowup, followupResult) : undefined;
  for (const part of parts) applyPreferredTranscriptLanguage(part, preferredLanguage);
  const primaryDisplayStatus = getMeetingDisplayStatus({
    botState: meeting.botState,
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
  const renderShareButton = (instanceId: string) =>
    canShare ? (
      <MeetingShareButton
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
        note={
          isComposed
            ? "Sharing applies to this meeting. Recipients also need access to each original recording."
            : undefined
        }
        teamMembers={shareRecipients}
      />
    ) : null;
  const notesContent = (
    <>
      <MeetingNotes
        key={`${workspace.userId}:${meetingId}`}
        meetingId={meetingId}
        userId={workspace.userId}
        momentSources={(isComposed ? parts : [meeting]).map(source => ({
          id: source.id,
          durationMs: source.durationMs,
          recordings: source.recordingParts ?? [],
          hasTranscript: source.segments.length > 0,
          recording: source.status === "recording",
        }))}
      />
      {isFollowupReady(followupMeeting) ? (
        <MeetingFollowup
          autoGenerate
          waitForBackground={followupJobMayBeRunning}
          canGenerate={canManage}
          initialResult={translatedFollowup ?? followupResult}
          needsTranslation={!!followupResult && preferredLanguage !== "en" && !translatedFollowup}
          preferredLanguage={preferredLanguage}
          initialConnections={getCurrentMeetingConnections(followupMeeting)}
          initialConnectionsRevision={getConnectionsRevision(followupMeeting)}
          initialConnectionIds={getCurrentMeetingConnectionIds(followupMeeting)}
          organizationDomains={organizationDomains}
          participants={participants}
          key={`${workspace.userId}:${meetingId}:${canManage}`}
          meetingId={meetingId}
          meetingTitle={followupMeeting.title}
          meetingStartedAt={followupSource.startedAt}
          segments={followupMeeting.segments.map(({ id, startMs, speaker, text, meetingSpeakerId, personId }) => ({ id, startMs, speaker, text, meetingSpeakerId, personId }))}
          sourceHash={followupSourceHash}
        />
      ) : null}
    </>
  );
  const transcriptContent = (
    <>
      {isComposed ? <>
        <p className="mb-5 text-sm text-muted-foreground">{parts.length} recordings. Each part keeps its original audio and sharing.</p>
        <MeetingComposedTranscripts meetings={parts} primaryMeetingId={meetingId} preferredTranslationLanguage={preferredLanguage} />
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
        canOpenPeople={canOpenPeople}
        navigationMeetingId={meetingId}
        hideHeading
        afterSpeakers={
          <MeetingEntityLinks entities={meeting.entities} />
        }
        preferredTranslationLanguage={preferredLanguage}
        segments={meeting.segments}
        speakerAliases={meeting.speakerAliases}
        speakerSuggestions={meeting.speakerSuggestions}
        translationMeetingId={meetingId}
        translationLanguage={meeting.translationLanguage}
        translationSummary={meeting.translationSummary}
        visualAssets={continuousVisualAssets}
      />}

      {isComposed ? (
        <div className="mt-8">
          <MeetingEntityLinks entities={meeting.entities} />
        </div>
      ) : null}
    </>
  );
  return (
    <AppShell
      activeHref="/dashboard"
      amplitudeTeamId={workspace.teamId}
      canCreateMeetings={workspace.canCreateMeetings !== false}
      oneSignalExternalId={workspace.userId}
    >
      <div className="flex w-full min-w-0 flex-col gap-10 has-[[data-persistent-player]]:pb-48">
        <section className="flex min-w-0 flex-wrap items-start gap-x-6">
          <MeetingAutoRefresh
            meetingStatus={meeting.status}
            segmentCount={meeting.segments.length}
            transcriptJobStatus={meeting.transcriptJobStatus}
            translationStatus={meeting.translationSummary.status}
          />
          <div className="order-2 ml-auto flex flex-wrap items-center justify-end gap-1 pt-1">
            {shouldCenterMeetingSource
              ? null
              : renderShareButton("meeting-sharing")}
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
              canReplaceLink={!isComposed && canManage && canReplaceMeetingLink(meeting)}
              meetingUrl={meeting.meetingUrl}
              hasAudio={
                parts.some(part => Boolean(part.audioUrl) || part.recordingParts.length > 0)
              }
              hasTranscript={parts.some(part => part.segments.length > 0)}
              imageCount={parts.reduce((sum, part) => sum + part.visualAssets.length, 0)}
              instanceId="header"
              meetingId={meetingId}
            />
          </div>
          {composition.parent ? <p className="order-3 mt-2 basis-full text-sm text-muted-foreground">Part of <Link className="underline underline-offset-4" href={`/meetings/${composition.parent.id}`}>{composition.parent.title}</Link></p> : null}
          <div className="order-1 min-w-0 basis-full sm:flex-1 sm:basis-0">
            {canManage ? (
              <MeetingTitleEditor
                meetingId={meetingId}
                meetingTitle={meeting.title}
              />
            ) : (
              <h1 className="break-words text-2xl font-semibold tracking-[-0.015em]">
                {meeting.title}
              </h1>
            )}
          </div>
          <div className="order-3 basis-full">
          <MeetingHeaderMetadata
            durationMs={isComposed ? parts.every(part => part.durationMs !== null) ? parts.reduce((sum, part) => sum + (part.durationMs ?? 0), 0) : null : meeting.durationMs}
            endedAt={meeting.endedAt}
            platform={formatPlatform(meeting.platform)}
            startedAt={meeting.startedAt}
            status={displayStatus === "scheduled" && composition.sources.some(source => source.kind === "continuation" && source.status === "scheduled") ? "Waiting to join" : formatStatus(displayStatus)}
          />
          </div>
          {participants.length > 0 || relatedMeetings.length > 0 ? (
            <div className="order-3 mt-1 flex basis-full flex-wrap items-baseline gap-x-3 gap-y-1">
              {participants.length > 0 ? (
                <ParticipantList
                  canOpenPeople={canOpenPeople}
                  meetingId={canManage ? meetingId : undefined}
                  participants={participants.map(participant => ({ ...participant, personId: participantPeople.get(participant.email.trim().toLowerCase()) ?? null }))}
                />
              ) : null}
              {participants.length > 0 && relatedMeetings.length > 0 ? (
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ·
                </span>
              ) : null}
              {relatedMeetings.length > 0 ? (
                <RelatedMeetingsCard meetings={relatedMeetings} />
              ) : null}
            </div>
          ) : null}
          {canManage ? null : (
            <p className="order-3 mt-3 basis-full text-sm text-muted-foreground">
              Shared transcript. You can read and share this transcript.
              Editing stays with the meeting owner.
            </p>
          )}
        </section>

        <section className="min-w-0">
          <div>
            {shouldCenterMeetingSource ? notesContent : null}
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
                    <div className="rounded-2xl bg-muted p-5">
                      <h2 className="text-base font-semibold">
                        Record this Teams meeting locally
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Open Tape for Mac. This meeting appears in Pending
                        meetings during its recording window, and the app sends
                        a notification when local capture becomes available.
                      </p>
                    </div>
                    <details className="px-1">
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
                    <details className="px-1">
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
              <MeetingViewTabs
                initialView={initialView}
                notes={notesContent}
                transcript={transcriptContent}
              />
            )}
          </div>
        </section>

        {canManage && canAddMeetingSource && !shouldCenterMeetingSource ? (
          <MeetingRecoveryUploadPanel meetingId={meetingId} />
        ) : null}
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

  if (status === "waiting_room") {
    return "In waiting room";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

const VISIBLE_PARTICIPANT_COUNT = 6;

/**
 * Names after the first few sit behind a disclosure, so a large call does not
 * push the transcript down the page.
 */
function ParticipantList({
  canOpenPeople,
  meetingId,
  participants,
}: {
  canOpenPeople: boolean;
  meetingId?: string;
  participants: Array<{ email: string; name: string | null; personId: string | null }>;
}) {
  const visible = participants.slice(0, VISIBLE_PARTICIPANT_COUNT);
  const hidden = participants.slice(VISIBLE_PARTICIPANT_COUNT);
  const label = (participant: { email: string; name: string | null; personId: string | null }) => {
    const text = participant.name || participant.email;
    return canOpenPeople ? (
      <PersonLink
        meetingId={meetingId}
        open={{ email: participant.email, name: participant.name }}
        personId={participant.personId}
        title={participant.email}
      >
        {text}
      </PersonLink>
    ) : text;
  };

  return (
    <div className="text-sm text-muted-foreground">
      <ul aria-label="Participants" className="inline">
        {visible.map((participant, index) => (
          <li className="inline" key={participant.email} title={participant.email}>
            {label(participant)}
            {index < visible.length - 1 || hidden.length > 0 ? ", " : ""}
          </li>
        ))}
      </ul>
      {hidden.length > 0 ? (
        <details className="group inline">
          <summary className="inline cursor-pointer list-none text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground group-open:hidden [&::-webkit-details-marker]:hidden">
            {hidden.length} more
          </summary>
          <ul aria-label="More participants" className="inline">
            {hidden.map((participant, index) => (
              <li
                className="inline"
                key={participant.email}
                title={participant.email}
              >
                {label(participant)}
                {index < hidden.length - 1 ? ", " : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

