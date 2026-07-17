import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const meetingPlatform = pgEnum("meeting_platform", [
  "google_meet",
  "in_person",
  "zoom",
  "upload",
]);
export const meetingStatus = pgEnum("meeting_status", [
  "scheduled",
  "recording",
  "processing",
  "ready",
  "failed",
  "missed",
  "cancelled",
]);
export const accessRole = pgEnum("access_role", [
  "owner",
  "admin",
  "attendee",
  "shared",
]);
export const assetSource = pgEnum("asset_source", [
  "upload",
  "recall",
  "elevenlabs",
  "local_recorder",
]);
export const assetType = pgEnum("asset_type", [
  "audio",
  "computer_audio",
  "microphone_audio",
  "screenshot",
  "synthesized_audio",
  "video_frame",
  "transcript_source",
]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

export const allowedDomains = pgTable(
  "allowed_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("allowed_domains_domain_unique").on(table.domain),
    uniqueIndex("allowed_domains_team_domain_unique").on(
      table.teamId,
      table.domain,
    ),
  ],
);

export const teamVocabularyTerms = pgTable(
  "team_vocabulary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    hint: text("hint"),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("team_vocabulary_terms_team_term_unique").on(
      table.teamId,
      table.term,
    ),
  ],
);

export const teamSpeakerAliases = pgTable(
  "team_speaker_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    aliasKey: text("alias_key").notNull(),
    alias: text("alias").notNull(),
    canonicalName: text("canonical_name").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("team_speaker_aliases_team_alias_key_unique").on(
      table.teamId,
      table.aliasKey,
    ),
    index("team_speaker_aliases_team_canonical_index").on(
      table.teamId,
      table.canonicalName,
    ),
  ],
);

export const teamMeetingBotProfiles = pgTable(
  "team_meeting_bot_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    botName: text("bot_name").notNull().default("IOSG Old Friend"),
    avatarJpegBase64: text("avatar_jpeg_base64"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("team_meeting_bot_profiles_team_unique").on(table.teamId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: text("auth_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_auth_user_id_unique").on(table.authUserId),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("team_memberships_team_user_unique").on(
      table.teamId,
      table.userId,
    ),
  ],
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_account_unique").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google"),
    externalCalendarId: text("external_calendar_id").notNull(),
    autoJoinEnabled: boolean("auto_join_enabled").notNull().default(false),
    oauthAccessToken: text("oauth_access_token"),
    oauthRefreshToken: text("oauth_refresh_token"),
    oauthAccessTokenExpiresAt: timestamp("oauth_access_token_expires_at", {
      withTimezone: true,
    }),
    recallCalendarId: text("recall_calendar_id"),
    recallCalendarStatus: text("recall_calendar_status"),
    recallCalendarLastSyncedAt: timestamp("recall_calendar_last_synced_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_connections_recall_calendar_id_unique")
      .on(table.recallCalendarId)
      .where(sql`${table.recallCalendarId} is not null`),
  ],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    externalEventId: text("external_event_id").notNull(),
    title: text("title").notNull(),
    teamMeetingKey: text("team_meeting_key"),
    meetingUrl: text("meeting_url"),
    location: text("location"),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    attendeeEmails: jsonb("attendee_emails")
      .$type<string[]>()
      .notNull()
      .default([]),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_events_external_event_unique").on(
      table.connectionId,
      table.externalEventId,
    ),
  ],
);

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    calendarEventId: uuid("calendar_event_id").references(
      () => calendarEvents.id,
      {
        onDelete: "set null",
      },
    ),
    teamMeetingKey: text("team_meeting_key"),
    title: text("title").notNull(),
    titleSource: text("title_source").notNull().default("calendar"),
    platform: meetingPlatform("platform").notNull(),
    status: meetingStatus("status").notNull().default("scheduled"),
    meetingUrl: text("meeting_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    recallBotId: text("recall_bot_id"),
    recallRecordingId: text("recall_recording_id"),
    translationStatus: jobStatus("translation_status"),
    translationErrorMessage: text("translation_error_message"),
    translationStartedAt: timestamp("translation_started_at", {
      withTimezone: true,
    }),
    translationCompletedAt: timestamp("translation_completed_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meetings_team_meeting_key_unique")
      .on(table.teamId, table.teamMeetingKey)
      .where(sql`${table.teamMeetingKey} is not null`),
    index("meetings_search_index").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.meetingUrl}, ''))`,
    ),
    // Supports the stale-job reconcile cron, which sweeps meetings still in
    // flight. Partial so it stays tiny (these are the rare, transient states)
    // and keeps the 15-minute scan from walking the whole table.
    index("meetings_active_status_index")
      .on(table.status)
      .where(sql`${table.status} in ('recording', 'processing')`),
  ],
);

export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_attendees_meeting_email_unique").on(
      table.meetingId,
      table.email,
    ),
  ],
);

export const meetingAccess = pgTable(
  "meeting_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: accessRole("role").notNull(),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id").notNull().default("direct"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_access_meeting_user_unique").on(
      table.meetingId,
      table.userId,
    ),
    index("meeting_access_active_user_index").on(
      table.userId,
      table.meetingId,
      table.revokedAt,
    ),
  ],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("share_links_token_hash_unique").on(table.tokenHash)],
);

export const meetingShareInvites = pgTable(
  "meeting_share_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: accessRole("role").notNull().default("shared"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id").notNull().default("direct"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_share_invites_meeting_email_unique").on(
      table.meetingId,
      table.email,
    ),
    index("meeting_share_invites_email_index").on(table.email),
  ],
);

export const meetingSharePolicies = pgTable(
  "meeting_share_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seedMeetingId: uuid("seed_meeting_id").references(() => meetings.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    scope: text("scope").notNull(),
    role: accessRole("role").notNull().default("shared"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("meeting_share_policies_seed_active_index").on(
      table.seedMeetingId,
      table.revokedAt,
    ),
    index("meeting_share_policies_lookup_index").on(
      table.teamId,
      table.ownerUserId,
      table.scope,
      table.revokedAt,
    ),
  ],
);

export const meetingSharePolicyKeys = pgTable(
  "meeting_share_policy_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => meetingSharePolicies.id, { onDelete: "cascade" }),
    matchKey: text("match_key").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_share_policy_keys_policy_key_unique").on(
      table.policyId,
      table.matchKey,
    ),
    index("meeting_share_policy_keys_match_index").on(table.matchKey),
  ],
);

export const meetingAccessSources = pgTable(
  "meeting_access_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    role: accessRole("role").notNull().default("shared"),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_access_sources_source_unique").on(
      table.meetingId,
      table.recipientEmail,
      table.source,
      table.sourceId,
    ),
    index("meeting_access_sources_active_index").on(
      table.meetingId,
      table.recipientEmail,
      table.revokedAt,
    ),
  ],
);

export const meetingShareRules = pgTable(
  "meeting_share_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientEmail: text("recipient_email").notNull(),
    matchKey: text("match_key").notNull(),
    role: accessRole("role").notNull().default("shared"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_share_rules_scope_recipient_key_unique").on(
      table.teamId,
      table.ownerUserId,
      table.recipientEmail,
      table.matchKey,
    ),
    index("meeting_share_rules_future_lookup_index").on(
      table.teamId,
      table.ownerUserId,
      table.matchKey,
    ),
  ],
);

export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  source: assetSource("source").notNull(),
  durationMs: integer("duration_ms"),
  ...timestamps,
});

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id").references(() => recordings.id, {
      onDelete: "set null",
    }),
    source: assetSource("source").notNull(),
    type: assetType("type").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    checksum: text("checksum"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    timestampMs: integer("timestamp_ms"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("media_assets_bucket_object_unique").on(
      table.bucket,
      table.objectKey,
    ),
  ],
);

export const localRecorderDevices = pgTable(
  "local_recorder_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceIdHash: text("device_id_hash").notNull(),
    appVersion: text("app_version"),
    permissionReadiness: jsonb("permission_readiness")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("local_recorder_devices_team_user_device_unique").on(
      table.teamId,
      table.userId,
      table.deviceIdHash,
    ),
  ],
);

export const localRecordingAttempts = pgTable(
  "local_recording_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceIdHash: text("device_id_hash").notNull(),
    fallbackIntentIdHash: text("fallback_intent_id_hash").notNull(),
    notificationState: text("notification_state").notNull().default("shown"),
    attemptState: text("attempt_state").notNull().default("notified"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("local_recording_attempts_intent_unique").on(
      table.fallbackIntentIdHash,
    ),
    index("local_recording_attempts_meeting_index").on(table.meetingId),
    uniqueIndex("local_recording_attempts_primary_active_unique")
      .on(table.meetingId)
      .where(
        sql`${table.attemptState} in ('started', 'uploading', 'uploaded')`,
      ),
  ],
);

export const localRecorderDeviceSessions = pgTable(
  "local_recorder_device_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceIdHash: text("device_id_hash").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("local_recorder_device_sessions_token_unique").on(
      table.tokenHash,
    ),
    index("local_recorder_device_sessions_user_device_index").on(
      table.userId,
      table.deviceIdHash,
    ),
  ],
);

export const localRecordings = pgTable(
  "local_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localRecordingAttemptId: uuid("local_recording_attempt_id")
      .notNull()
      .references(() => localRecordingAttempts.id, { onDelete: "cascade" }),
    clientRecordingId: text("client_recording_id").notNull(),
    recordingStartedAt: timestamp("recording_started_at", {
      withTimezone: true,
    }).notNull(),
    recordingStoppedAt: timestamp("recording_stopped_at", {
      withTimezone: true,
    }).notNull(),
    computerAudioAssetId: uuid("computer_audio_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    microphoneAudioAssetId: uuid("microphone_audio_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    synthesizedAudioAssetId: uuid("synthesized_audio_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    manifest: jsonb("manifest").$type<unknown>().notNull().default({}),
    synthesisStatus: text("synthesis_status").notNull().default("queued"),
    synthesisErrorMessage: text("synthesis_error_message"),
    isPrimary: boolean("is_primary").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("local_recordings_owner_client_unique").on(
      table.ownerUserId,
      table.clientRecordingId,
    ),
    uniqueIndex("local_recordings_attempt_unique").on(
      table.localRecordingAttemptId,
    ),
    uniqueIndex("local_recordings_meeting_primary_unique")
      .on(table.meetingId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

export const transcriptJobs = pgTable(
  "transcript_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("elevenlabs"),
    providerJobId: text("provider_job_id"),
    status: jobStatus("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("transcript_jobs_provider_job_unique").on(
      table.provider,
      table.providerJobId,
    ),
    // Per-meeting job lookups: the stale-job reconcile anti-join and the
    // active-job checks (hasActiveTranscriptJob, claim eligibility) all filter
    // by meeting_id, ordered/keyed by recency.
    index("transcript_jobs_meeting_created_index").on(
      table.meetingId,
      table.createdAt,
    ),
  ],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => transcriptJobs.id, { onDelete: "cascade" }),
    speaker: text("speaker"),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms"),
    text: text("text").notNull(),
    polishedText: text("polished_text"),
    translatedText: text("translated_text"),
    translationEditedAt: timestamp("translation_edited_at", {
      withTimezone: true,
    }),
    emotionLabel: text("emotion_label"),
    emotionReason: text("emotion_reason"),
    ...timestamps,
  },
  (table) => [
    index("transcript_segments_meeting_text_index").on(table.meetingId),
    index("transcript_segments_search_index").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.text}, '') || ' ' || coalesce(${table.speaker}, ''))`,
    ),
  ],
);

export const meetingEntities = pgTable(
  "meeting_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => transcriptSegments.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    source: text("source").notNull().default("transcript"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_entities_meeting_type_value_unique").on(
      table.meetingId,
      table.type,
      table.normalizedValue,
    ),
    index("meeting_entities_normalized_value_index").on(table.normalizedValue),
  ],
);

export const meetingParticipantTimeline = pgTable(
  "meeting_participant_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    recallParticipantId: text("recall_participant_id"),
    name: text("name"),
    email: text("email"),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms"),
    source: text("source").notNull().default("recall"),
    ...timestamps,
  },
  (table) => [
    index("meeting_participant_timeline_meeting_index").on(table.meetingId),
    uniqueIndex("meeting_participant_timeline_unique").on(
      table.meetingId,
      table.recallParticipantId,
      table.startMs,
    ),
  ],
);

export const meetingReminders = pgTable(
  "meeting_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerNotificationId: text("provider_notification_id"),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_reminders_meeting_user_unique").on(
      table.meetingId,
      table.userId,
    ),
  ],
);

export const meetingLibraryViews = pgTable(
  "meeting_library_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("My view"),
    isDefault: boolean("is_default").notNull().default(true),
    query: text("query"),
    searchScope: text("search_scope").notNull().default("all"),
    status: text("status").notNull().default("all"),
    sort: text("sort").notNull().default("smart"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_library_views_user_team_default_unique").on(
      table.userId,
      table.teamId,
      table.isDefault,
    ),
  ],
);

export const vendorWebhookEvents = pgTable(
  "vendor_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("vendor_webhook_events_idempotency_unique").on(
      table.provider,
      table.idempotencyKey,
    ),
  ],
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
