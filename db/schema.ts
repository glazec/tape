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
]);
export const assetType = pgEnum("asset_type", [
  "audio",
  "screenshot",
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
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meeting_access_meeting_user_unique").on(
      table.meetingId,
      table.userId,
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
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
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
