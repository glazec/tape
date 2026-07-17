ALTER TABLE "meeting_access" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "meeting_access" ADD COLUMN "source_id" text DEFAULT 'direct' NOT NULL;
ALTER TABLE "meeting_access" ADD COLUMN "created_by_user_id" uuid;
ALTER TABLE "meeting_access" ADD COLUMN "revoked_at" timestamp with time zone;
ALTER TABLE "meeting_access" DROP CONSTRAINT IF EXISTS "meeting_access_created_by_user_id_users_id_fk";
ALTER TABLE "meeting_access" ADD CONSTRAINT "meeting_access_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
DROP INDEX IF EXISTS "meeting_access_meeting_user_unique";
CREATE UNIQUE INDEX "meeting_access_meeting_user_source_unique" ON "meeting_access" USING btree ("meeting_id", "user_id", "source", "source_id");
CREATE INDEX "meeting_access_active_user_index" ON "meeting_access" USING btree ("user_id", "meeting_id", "revoked_at");

ALTER TABLE "meeting_share_invites" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "meeting_share_invites" ADD COLUMN "source_id" text DEFAULT 'direct' NOT NULL;
ALTER TABLE "meeting_share_invites" ADD COLUMN "revoked_at" timestamp with time zone;
DROP INDEX IF EXISTS "meeting_share_invites_meeting_email_unique";
CREATE UNIQUE INDEX "meeting_share_invites_meeting_email_source_unique" ON "meeting_share_invites" USING btree ("meeting_id", "email", "source", "source_id");

ALTER TABLE "meeting_share_rules" ADD COLUMN "revoked_at" timestamp with time zone;

UPDATE "meeting_attendees" AS attendee
SET "is_internal" = true,
    "updated_at" = now()
FROM "meetings" AS meeting
JOIN "allowed_domains" AS domain
  ON domain."team_id" = meeting."team_id"
WHERE attendee."meeting_id" = meeting."id"
  AND domain."domain" = split_part(lower(attendee."email"), '@', 2);

INSERT INTO "meeting_access" (
  "meeting_id",
  "user_id",
  "role",
  "source",
  "source_id",
  "created_by_user_id"
)
SELECT DISTINCT
  attendee."meeting_id",
  app_user."id",
  'attendee'::"access_role",
  'participant',
  'calendar',
  meeting."owner_user_id"
FROM "meeting_attendees" AS attendee
JOIN "meetings" AS meeting ON meeting."id" = attendee."meeting_id"
JOIN "users" AS app_user ON lower(app_user."email") = lower(attendee."email")
JOIN "team_memberships" AS membership
  ON membership."team_id" = meeting."team_id"
  AND membership."user_id" = app_user."id"
  AND membership."role" <> 'external'
WHERE attendee."is_internal" = true
  AND app_user."id" <> meeting."owner_user_id"
ON CONFLICT ("meeting_id", "user_id", "source", "source_id") DO UPDATE
SET "role" = excluded."role",
    "revoked_at" = null,
    "updated_at" = now();

INSERT INTO "meeting_share_invites" (
  "meeting_id",
  "email",
  "role",
  "created_by_user_id",
  "source",
  "source_id"
)
SELECT DISTINCT
  attendee."meeting_id",
  lower(attendee."email"),
  'attendee'::"access_role",
  meeting."owner_user_id",
  'participant',
  'calendar'
FROM "meeting_attendees" AS attendee
JOIN "meetings" AS meeting ON meeting."id" = attendee."meeting_id"
LEFT JOIN "users" AS app_user ON lower(app_user."email") = lower(attendee."email")
WHERE attendee."is_internal" = true
  AND app_user."id" IS NULL
ON CONFLICT ("meeting_id", "email", "source", "source_id") DO UPDATE
SET "role" = excluded."role",
    "revoked_at" = null,
    "updated_at" = now();
