# Otter Alternative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable team meeting transcript product from the approved design.

**Architecture:** Next.js owns the web app and API routes. Neon Auth identifies users, Neon Postgres stores product records and transcript search data, Cloudflare R2 stores binary media, Recall.ai captures meetings, ElevenLabs transcribes audio, and Inngest orchestrates long running jobs. Vendor APIs are isolated behind adapter modules so the database remains the source of truth.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Drizzle ORM, Neon Postgres, Neon Auth, Cloudflare R2, Inngest, Recall.ai, ElevenLabs, Vitest, Playwright.

---

## File Structure

Create this structure:

```text
app/
  api/
    upload/route.ts
    recall/webhook/route.ts
    elevenlabs/webhook/route.ts
    inngest/route.ts
  dashboard/page.tsx
  meetings/[meetingId]/page.tsx
  meetings/new/page.tsx
  settings/team/page.tsx
  share/[token]/page.tsx
  layout.tsx
  page.tsx
components/
  app-shell.tsx
  meeting-list.tsx
  transcript-viewer.tsx
  upload-dropzone.tsx
  share-dialog.tsx
db/
  client.ts
  schema.ts
  migrations/
inngest/
  client.ts
  functions.ts
lib/
  auth.ts
  access.ts
  env.ts
  r2.ts
  search.ts
  vendors/
    recall.ts
    elevenlabs.ts
tests/
  access.test.ts
  ingest.test.ts
  r2.test.ts
  search.test.ts
  e2e/
    meeting-upload.spec.ts
```

Responsibilities:

1. `db/schema.ts` defines product owned tables and relations.
2. `lib/access.ts` owns internal attendee access rules and share link checks.
3. `lib/r2.ts` owns object key generation, upload URL creation, and signed read URLs.
4. `lib/vendors/recall.ts` owns Recall API calls and webhook normalization.
5. `lib/vendors/elevenlabs.ts` owns transcription job creation and webhook normalization.
6. `inngest/functions.ts` owns async workflow orchestration.
7. App routes call small domain functions and never call vendor SDKs directly.

## Task 1: Scaffold App And Tooling

**Files:**

1. Create: `package.json`
2. Create: `tsconfig.json`
3. Create: `next.config.ts`
4. Create: `postcss.config.mjs`
5. Create: `tailwind.config.ts`
6. Create: `app/globals.css`
7. Create: `app/layout.tsx`
8. Create: `vitest.config.ts`
9. Create: `playwright.config.ts`
10. Create: `.env.example`
11. Modify: `.gitignore`

- [ ] **Step 1: Scaffold the Next.js app**

Run:

```bash
npm create next-app@latest . -- --ts --tailwind --eslint --app --src-dir false --import-alias "@/*"
```

Expected: Next.js files are created in `/Users/glaze/developer/meeting-note`.

- [ ] **Step 2: Install product dependencies**

Run:

```bash
npm install drizzle-orm @neondatabase/serverless inngest @aws-sdk/client-s3 @aws-sdk/s3-request-presigner zod jose
npm install -D drizzle-kit vitest @vitest/ui playwright @playwright/test
```

Expected: `package.json` contains the listed dependencies.

- [ ] **Step 3: Add test scripts**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 4: Add Vitest config**

Write `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 5: Add Playwright config**

Write `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

- [ ] **Step 6: Add environment contract**

Write `.env.example`:

```bash
DATABASE_URL=
NEON_AUTH_JWKS_URL=
NEON_AUTH_ISSUER=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=
RECALL_API_KEY=
RECALL_WEBHOOK_SECRET=
ELEVENLABS_API_KEY=
ELEVENLABS_WEBHOOK_SECRET=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 7: Ensure local browser artifacts are ignored**

Write `.gitignore` entries:

```gitignore
.next/
node_modules/
.env
.env.local
.superpowers/
test-results/
playwright-report/
```

- [ ] **Step 8: Add Geist based global styles**

Write `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #ffffff;
  --surface: #fafafa;
  --border: #eaeaea;
  --text: #171717;
  --muted: #4d4d4d;
  --primary: #006bff;
}

body {
  background: var(--background);
  color: var(--text);
  font-family: Geist, Arial, sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}
```

- [ ] **Step 9: Add app layout**

Write `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meeting Transcript",
  description: "Team meeting transcript workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 10: Verify scaffold**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands complete without errors.

- [ ] **Step 11: Commit**

Run:

```bash
git add .
git commit -m "chore: scaffold transcript app"
```

## Task 2: Define Database Schema And Access Rules

**Files:**

1. Create: `db/client.ts`
2. Create: `db/schema.ts`
3. Create: `lib/env.ts`
4. Create: `lib/access.ts`
5. Create: `tests/access.test.ts`
6. Create: `drizzle.config.ts`

- [ ] **Step 1: Add typed environment loader**

Write `lib/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NEON_AUTH_JWKS_URL: z.string().url(),
  NEON_AUTH_ISSUER: z.string().url(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  RECALL_API_KEY: z.string().min(1),
  RECALL_WEBHOOK_SECRET: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(1),
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export const env = schema.parse(process.env);
```

- [ ] **Step 2: Write access rule tests first**

Write `tests/access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canAutoGrantAttendeeAccess, normalizeEmailDomain } from "@/lib/access";

describe("normalizeEmailDomain", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmailDomain(" Alice@Example.COM ")).toBe("example.com");
  });
});

describe("canAutoGrantAttendeeAccess", () => {
  it("grants access to existing members on allowed domains", () => {
    expect(
      canAutoGrantAttendeeAccess({
        attendeeEmail: "alice@example.com",
        memberEmails: ["alice@example.com"],
        allowedDomains: ["example.com"],
      }),
    ).toBe(true);
  });

  it("denies external attendees even when present on the calendar", () => {
    expect(
      canAutoGrantAttendeeAccess({
        attendeeEmail: "guest@vendor.com",
        memberEmails: ["alice@example.com"],
        allowedDomains: ["example.com"],
      }),
    ).toBe(false);
  });

  it("denies internal domain emails that are not workspace members", () => {
    expect(
      canAutoGrantAttendeeAccess({
        attendeeEmail: "newhire@example.com",
        memberEmails: ["alice@example.com"],
        allowedDomains: ["example.com"],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run access tests and verify failure**

Run:

```bash
npm run test -- tests/access.test.ts
```

Expected: FAIL because `@/lib/access` does not exist.

- [ ] **Step 4: Implement access rules**

Write `lib/access.ts`:

```ts
type AutoGrantInput = {
  attendeeEmail: string;
  memberEmails: string[];
  allowedDomains: string[];
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeEmailDomain(email: string) {
  const normalized = normalizeEmail(email);
  const [, domain] = normalized.split("@");
  return domain ?? "";
}

export function canAutoGrantAttendeeAccess(input: AutoGrantInput) {
  const attendeeEmail = normalizeEmail(input.attendeeEmail);
  const attendeeDomain = normalizeEmailDomain(attendeeEmail);
  const memberEmails = new Set(input.memberEmails.map(normalizeEmail));
  const allowedDomains = new Set(input.allowedDomains.map((domain) => domain.trim().toLowerCase()));

  return memberEmails.has(attendeeEmail) && allowedDomains.has(attendeeDomain);
}
```

- [ ] **Step 5: Add database client**

Write `db/client.ts`:

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

const sql = neon(env.DATABASE_URL);

export const db = drizzle(sql, { schema });
```

- [ ] **Step 6: Add Drizzle schema**

Write `db/schema.ts`:

```ts
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const meetingPlatform = pgEnum("meeting_platform", ["google_meet", "zoom", "upload"]);
export const meetingStatus = pgEnum("meeting_status", ["scheduled", "recording", "processing", "ready", "failed"]);
export const accessRole = pgEnum("access_role", ["owner", "admin", "attendee", "shared"]);
export const assetSource = pgEnum("asset_source", ["upload", "recall", "elevenlabs"]);
export const assetType = pgEnum("asset_type", ["audio", "screenshot", "video_frame", "transcript_source"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed"]);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

export const allowedDomains = pgTable(
  "allowed_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    ...timestamps,
  },
  (table) => ({
    teamDomainUnique: uniqueIndex("allowed_domains_team_domain_unique").on(table.teamId, table.domain),
  }),
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
  (table) => ({
    authUserUnique: uniqueIndex("users_auth_user_id_unique").on(table.authUserId),
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    ...timestamps,
  },
  (table) => ({
    teamUserUnique: uniqueIndex("team_memberships_team_user_unique").on(table.teamId, table.userId),
  }),
);

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    ...timestamps,
  },
  (table) => ({
    providerAccountUnique: uniqueIndex("oauth_accounts_provider_account_unique").on(
      table.provider,
      table.providerAccountId,
    ),
  }),
);

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("google"),
  externalCalendarId: text("external_calendar_id").notNull(),
  autoJoinEnabled: boolean("auto_join_enabled").notNull().default(false),
  ...timestamps,
});

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull().references(() => calendarConnections.id, { onDelete: "cascade" }),
    externalEventId: text("external_event_id").notNull(),
    title: text("title").notNull(),
    meetingUrl: text("meeting_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    attendeeEmails: jsonb("attendee_emails").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => ({
    externalEventUnique: uniqueIndex("calendar_events_external_event_unique").on(
      table.connectionId,
      table.externalEventId,
    ),
  }),
);

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  calendarEventId: uuid("calendar_event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  platform: meetingPlatform("platform").notNull(),
  status: meetingStatus("status").notNull().default("scheduled"),
  meetingUrl: text("meeting_url"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  recallBotId: text("recall_bot_id"),
  recallRecordingId: text("recall_recording_id"),
  ...timestamps,
});

export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    meetingEmailUnique: uniqueIndex("meeting_attendees_meeting_email_unique").on(table.meetingId, table.email),
  }),
);

export const meetingAccess = pgTable(
  "meeting_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: accessRole("role").notNull(),
    ...timestamps,
  },
  (table) => ({
    meetingUserUnique: uniqueIndex("meeting_access_meeting_user_unique").on(table.meetingId, table.userId),
  }),
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("share_links_token_hash_unique").on(table.tokenHash),
  }),
);

export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  source: assetSource("source").notNull(),
  durationMs: integer("duration_ms"),
  ...timestamps,
});

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id").references(() => recordings.id, { onDelete: "set null" }),
    source: assetSource("source").notNull(),
    type: assetType("type").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    checksum: text("checksum"),
    ...timestamps,
  },
  (table) => ({
    bucketObjectUnique: uniqueIndex("media_assets_bucket_object_unique").on(table.bucket, table.objectKey),
  }),
);

export const transcriptJobs = pgTable(
  "transcript_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    provider: text("provider").notNull().default("elevenlabs"),
    providerJobId: text("provider_job_id"),
    status: jobStatus("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => ({
    providerJobUnique: uniqueIndex("transcript_jobs_provider_job_unique").on(table.provider, table.providerJobId),
  }),
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull().references(() => transcriptJobs.id, { onDelete: "cascade" }),
    speaker: text("speaker"),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms"),
    text: text("text").notNull(),
    ...timestamps,
  },
  (table) => ({
    meetingTextIndex: index("transcript_segments_meeting_text_index").on(table.meetingId),
  }),
);

export const vendorWebhookEvents = pgTable(
  "vendor_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    webhookIdempotencyUnique: uniqueIndex("vendor_webhook_events_idempotency_unique").on(
      table.provider,
      table.idempotencyKey,
    ),
  }),
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 7: Add Drizzle config**

Write `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
```

- [ ] **Step 8: Verify tests and schema generation**

Run:

```bash
npm run test -- tests/access.test.ts
npx drizzle-kit generate
```

Expected: access tests pass and a migration file is created under `db/migrations`.

- [ ] **Step 9: Commit**

Run:

```bash
git add db lib tests drizzle.config.ts package.json package-lock.json
git commit -m "feat: add database schema and access rules"
```

## Task 3: Add Auth And Team Bootstrap

**Files:**

1. Create: `lib/auth.ts`
2. Create: `app/page.tsx`
3. Create: `app/settings/team/page.tsx`
4. Create: `components/app-shell.tsx`
5. Test: `tests/access.test.ts`

- [ ] **Step 1: Add auth helper**

Write `lib/auth.ts`:

```ts
import { jwtVerify, createRemoteJWKSet } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

const jwks = createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL));

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get("session")?.value;
  if (!token) return null;

  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.NEON_AUTH_ISSUER,
  });

  if (!payload.sub || typeof payload.email !== "string") return null;

  return {
    id: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
```

- [ ] **Step 2: Add landing sign in screen**

Write `app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
      <p className="text-sm text-[#4d4d4d]">Team transcript workspace</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-normal text-[#171717]">
        Record meetings. Search transcripts. Share access with your team.
      </h1>
      <a
        className="mt-8 inline-flex w-fit items-center rounded-md bg-[#006bff] px-4 py-2 text-sm font-medium text-white"
        href="/api/auth/signin/google"
      >
        Sign in with Google
      </a>
    </main>
  );
}
```

- [ ] **Step 3: Add app shell**

Write `components/app-shell.tsx`:

```tsx
import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#171717]">
      <header className="border-b border-[#eaeaea]">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4 text-sm">
          <Link className="font-semibold" href="/dashboard">Meetings</Link>
          <Link href="/meetings/new">Record</Link>
          <Link href="/settings/team">Team</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Add team settings page**

Write `app/settings/team/page.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function TeamSettingsPage() {
  const user = await getCurrentUser();

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Team settings</h1>
      <p className="mt-2 text-sm text-[#4d4d4d]">
        Signed in as {user?.email ?? "unknown user"}.
      </p>
      <section className="mt-8 rounded-md border border-[#eaeaea] p-4">
        <h2 className="text-base font-medium">Allowed internal domains</h2>
        <p className="mt-2 text-sm text-[#4d4d4d]">
          Internal attendees get automatic access only when their email belongs to an allowed domain and they are a team member.
        </p>
      </section>
    </AppShell>
  );
}
```

- [ ] **Step 5: Verify UI compiles**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add app components lib/auth.ts
git commit -m "feat: add auth shell and team settings"
```

## Task 4: Add Cloudflare R2 Media Layer

**Files:**

1. Create: `lib/r2.ts`
2. Create: `tests/r2.test.ts`
3. Create: `app/api/upload/route.ts`
4. Create: `components/upload-dropzone.tsx`

- [ ] **Step 1: Write R2 key tests first**

Write `tests/r2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMeetingObjectKey } from "@/lib/r2";

describe("buildMeetingObjectKey", () => {
  it("creates stable namespaced object keys", () => {
    expect(
      buildMeetingObjectKey({
        teamId: "team_123",
        meetingId: "meeting_456",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toBe("teams/team_123/meetings/meeting_456/assets/asset_789.mp3");
  });
});
```

- [ ] **Step 2: Run R2 tests and verify failure**

Run:

```bash
npm run test -- tests/r2.test.ts
```

Expected: FAIL because `buildMeetingObjectKey` is missing.

- [ ] **Step 3: Implement R2 helper**

Write `lib/r2.ts`:

```ts
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export function buildMeetingObjectKey(input: {
  teamId: string;
  meetingId: string;
  assetId: string;
  extension: string;
}) {
  return `teams/${input.teamId}/meetings/${input.meetingId}/assets/${input.assetId}.${input.extension}`;
}

export async function createUploadUrl(input: {
  key: string;
  contentType: string;
}) {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
  });

  return getSignedUrl(client, command, { expiresIn: 900 });
}
```

- [ ] **Step 4: Add upload API route**

Write `app/api/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createUploadUrl, buildMeetingObjectKey } from "@/lib/r2";

const bodySchema = z.object({
  teamId: z.string().min(1),
  meetingId: z.string().min(1),
  assetId: z.string().min(1),
  extension: z.literal("mp3"),
  contentType: z.literal("audio/mpeg"),
});

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json());
  const key = buildMeetingObjectKey(body);
  const uploadUrl = await createUploadUrl({ key, contentType: body.contentType });

  return NextResponse.json({ key, uploadUrl });
}
```

- [ ] **Step 5: Add upload component**

Write `components/upload-dropzone.tsx`:

```tsx
"use client";

export function UploadDropzone() {
  return (
    <form className="rounded-md border border-[#eaeaea] p-4">
      <label className="block text-sm font-medium" htmlFor="audio">
        Upload MP3
      </label>
      <input
        id="audio"
        name="audio"
        type="file"
        accept="audio/mpeg"
        className="mt-3 block w-full text-sm"
      />
      <button className="mt-4 rounded-md bg-[#006bff] px-4 py-2 text-sm font-medium text-white">
        Upload
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Verify R2 tests**

Run:

```bash
npm run test -- tests/r2.test.ts
npm run build
```

Expected: R2 tests and build pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/api/upload components/upload-dropzone.tsx lib/r2.ts tests/r2.test.ts
git commit -m "feat: add r2 media upload layer"
```

## Task 5: Add Vendor Adapters

**Files:**

1. Create: `lib/vendors/recall.ts`
2. Create: `lib/vendors/elevenlabs.ts`
3. Create: `tests/ingest.test.ts`
4. Create: `app/api/recall/webhook/route.ts`
5. Create: `app/api/elevenlabs/webhook/route.ts`

- [ ] **Step 1: Write webhook normalization tests**

Write `tests/ingest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeRecallWebhook } from "@/lib/vendors/recall";
import { normalizeElevenLabsWebhook } from "@/lib/vendors/elevenlabs";

describe("normalizeRecallWebhook", () => {
  it("extracts bot status and recording identifiers", () => {
    expect(
      normalizeRecallWebhook({
        event: "bot.status_change",
        data: {
          data: {
            code: "done",
            sub_code: "recording_done",
            updated_at: "2026-06-23T12:00:00Z",
          },
          bot: {
            id: "bot_123",
            metadata: {
              requested_webhook_url: "https://app.example.com/api/recall/webhook",
            },
          },
        },
      }),
    ).toEqual({
      eventType: "bot.status_change",
      botId: "bot_123",
      statusCode: "done",
      code: "done",
      subCode: "recording_done",
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        requested_webhook_url: "https://app.example.com/api/recall/webhook",
      },
    });
  });
});

describe("normalizeElevenLabsWebhook", () => {
  it("extracts transcript completion status", () => {
    expect(
      normalizeElevenLabsWebhook({
        type: "speech_to_text_transcription",
        data: {
          request_id: "req_123",
          webhook_metadata: {
            requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
          },
          transcription: {
            text: "Transcript text",
          },
        },
      }),
    ).toEqual({
      eventType: "speech_to_text_transcription",
      type: "speech_to_text_transcription",
      requestId: "req_123",
      status: "completed",
      transcriptionText: "Transcript text",
      metadata: {
        requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
      },
    });
  });
});
```

- [ ] **Step 2: Run ingest tests and verify failure**

Run:

```bash
npm run test -- tests/ingest.test.ts
```

Expected: FAIL because vendor adapter modules do not exist.

- [ ] **Step 3: Implement Recall adapter**

Write `lib/vendors/recall.ts`:

```ts
import { z } from "zod";
import { env } from "@/lib/env";

const recallWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    data: z.object({
      code: z.string(),
      sub_code: z.string().optional(),
      updated_at: z.string().optional(),
    }),
    bot: z.object({
      id: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
});

export function normalizeRecallWebhook(payload: unknown) {
  const parsed = recallWebhookSchema.parse(payload);
  return {
    eventType: parsed.event,
    botId: parsed.data.bot.id,
    statusCode: parsed.data.data.code,
    code: parsed.data.data.code,
    subCode: parsed.data.data.sub_code ?? null,
    updatedAt: parsed.data.data.updated_at ?? null,
    metadata: parsed.data.bot.metadata ?? {},
  };
}

export async function scheduleRecallBot(input: {
  meetingUrl: string;
  startAt?: string;
  webhookUrl: string;
}) {
  const response = await fetch("https://api.recall.ai/api/v1/bot", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.RECALL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meeting_url: input.meetingUrl,
      bot_name: "Transcript Bot",
      recording_config: { transcript: { provider: { meeting_captions: false } } },
      real_time_media: false,
      metadata: { requested_webhook_url: input.webhookUrl },
      join_at: input.startAt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Recall schedule failed with ${response.status}`);
  }

  return response.json();
}
```

- [ ] **Step 4: Implement ElevenLabs adapter**

Write `lib/vendors/elevenlabs.ts`:

```ts
import { z } from "zod";
import { env } from "@/lib/env";

const elevenWebhookSchema = z.object({
  type: z.string(),
  data: z.object({
    request_id: z.string(),
    webhook_metadata: z.record(z.string(), z.unknown()).optional(),
    transcription: z.object({
      text: z.string().optional(),
      status: z.string().optional(),
    }).passthrough().optional(),
  }),
});

export function normalizeElevenLabsWebhook(payload: unknown) {
  const parsed = elevenWebhookSchema.parse(payload);
  return {
    eventType: parsed.type,
    type: parsed.type,
    requestId: parsed.data.request_id,
    status: parsed.data.transcription?.status ?? "completed",
    transcriptionText: parsed.data.transcription?.text ?? null,
    metadata: parsed.data.webhook_metadata ?? {},
  };
}

export async function createElevenLabsTranscriptJob(input: {
  audioUrl: string;
  webhookUrl: string;
}) {
  const body = new FormData();
  body.append("model_id", "scribe_v2");
  body.append("source_url", input.audioUrl);
  body.append("webhook", "true");
  body.append(
    "webhook_metadata",
    JSON.stringify({ requestedWebhookUrl: input.webhookUrl }),
  );

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs transcription failed with ${response.status}`);
  }

  return response.json();
}
```

- [ ] **Step 5: Add webhook routes**

Write `app/api/recall/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { normalizeRecallWebhook } from "@/lib/vendors/recall";

export async function POST(request: Request) {
  const payload = await request.json();
  const event = normalizeRecallWebhook(payload);
  return NextResponse.json({ received: true, event });
}
```

Write `app/api/elevenlabs/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { normalizeElevenLabsWebhook } from "@/lib/vendors/elevenlabs";

export async function POST(request: Request) {
  const payload = await request.json();
  const event = normalizeElevenLabsWebhook(payload);
  return NextResponse.json({ received: true, event });
}
```

- [ ] **Step 6: Verify adapters**

Run:

```bash
npm run test -- tests/ingest.test.ts
npm run build
```

Expected: ingest tests and build pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/api/recall app/api/elevenlabs lib/vendors tests/ingest.test.ts
git commit -m "feat: add meeting vendor adapters"
```

## Task 6: Add Inngest Workflow Orchestration

**Files:**

1. Create: `inngest/client.ts`
2. Create: `inngest/functions.ts`
3. Create: `app/api/inngest/route.ts`

- [ ] **Step 1: Add Inngest client**

Write `inngest/client.ts`:

```ts
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "meeting-transcript" });
```

- [ ] **Step 2: Add workflow functions**

Write `inngest/functions.ts`:

```ts
import { inngest } from "./client";
import { scheduleRecallBot } from "@/lib/vendors/recall";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import { env } from "@/lib/env";

export const scheduleMeetingBot = inngest.createFunction(
  { id: "schedule-meeting-bot" },
  { event: "meeting/schedule.bot" },
  async ({ event }) => {
    const { meetingUrl, startAt } = event.data as {
      meetingUrl: string;
      startAt?: string;
    };

    return scheduleRecallBot({
      meetingUrl,
      startAt,
      webhookUrl: `${env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`,
    });
  },
);

export const transcribeAudio = inngest.createFunction(
  { id: "transcribe-audio" },
  { event: "meeting/transcribe.audio" },
  async ({ event }) => {
    const { audioUrl } = event.data as { audioUrl: string };

    return createElevenLabsTranscriptJob({
      audioUrl,
      webhookUrl: `${env.NEXT_PUBLIC_APP_URL}/api/elevenlabs/webhook`,
    });
  },
);

export const functions = [scheduleMeetingBot, transcribeAudio];
```

- [ ] **Step 3: Add Inngest route**

Write `app/api/inngest/route.ts`:

```ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
```

- [ ] **Step 4: Verify build**

Run:

```bash
npm run build
```

Expected: build passes and `/api/inngest` is compiled.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/api/inngest inngest
git commit -m "feat: add meeting workflow orchestration"
```

## Task 7: Build Transcript Product UI

**Files:**

1. Create: `components/meeting-list.tsx`
2. Create: `components/transcript-viewer.tsx`
3. Create: `components/share-dialog.tsx`
4. Create: `app/dashboard/page.tsx`
5. Create: `app/meetings/[meetingId]/page.tsx`
6. Create: `app/meetings/new/page.tsx`
7. Create: `app/share/[token]/page.tsx`
8. Create: `lib/search.ts`
9. Create: `tests/search.test.ts`

- [ ] **Step 1: Write search query test first**

Write `tests/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTranscriptSearchQuery } from "@/lib/search";

describe("buildTranscriptSearchQuery", () => {
  it("trims and splits search text", () => {
    expect(buildTranscriptSearchQuery("  budget review  ")).toEqual(["budget", "review"]);
  });
});
```

- [ ] **Step 2: Run search test and verify failure**

Run:

```bash
npm run test -- tests/search.test.ts
```

Expected: FAIL because `lib/search.ts` does not exist.

- [ ] **Step 3: Implement search helper**

Write `lib/search.ts`:

```ts
export function buildTranscriptSearchQuery(input: string) {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}
```

- [ ] **Step 4: Add meeting list component**

Write `components/meeting-list.tsx`:

```tsx
type MeetingListItem = {
  id: string;
  title: string;
  platform: "google_meet" | "zoom" | "upload";
  startedAt: string;
  status: "scheduled" | "recording" | "processing" | "ready" | "failed";
};

export function MeetingList({ meetings }: { meetings: MeetingListItem[] }) {
  return (
    <div className="divide-y divide-[#eaeaea] rounded-md border border-[#eaeaea]">
      {meetings.map((meeting) => (
        <a
          className="block px-4 py-3 hover:bg-[#fafafa]"
          href={`/meetings/${meeting.id}`}
          key={meeting.id}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{meeting.title}</p>
              <p className="mt-1 text-sm text-[#4d4d4d]">{meeting.platform}</p>
            </div>
            <span className="text-sm text-[#4d4d4d]">{meeting.status}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Add transcript viewer**

Write `components/transcript-viewer.tsx`:

```tsx
type Segment = {
  id: string;
  speaker: string | null;
  startMs: number;
  text: string;
};

export function TranscriptViewer({ segments }: { segments: Segment[] }) {
  return (
    <div className="space-y-4">
      {segments.map((segment) => (
        <article className="rounded-md border border-[#eaeaea] p-4" key={segment.id}>
          <p className="text-xs text-[#4d4d4d]">
            {segment.speaker ?? "Speaker"} · {Math.floor(segment.startMs / 1000)}s
          </p>
          <p className="mt-2 text-sm leading-6">{segment.text}</p>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Add share dialog component**

Write `components/share-dialog.tsx`:

```tsx
export function ShareDialog({ meetingId }: { meetingId: string }) {
  return (
    <section className="rounded-md border border-[#eaeaea] p-4">
      <h2 className="text-base font-medium">Share transcript</h2>
      <p className="mt-2 text-sm text-[#4d4d4d]">
        Links are disabled by default, expire after 14 days, and can be revoked.
      </p>
      <button
        className="mt-4 rounded-md bg-[#006bff] px-4 py-2 text-sm font-medium text-white"
        type="button"
        data-meeting-id={meetingId}
      >
        Create share link
      </button>
    </section>
  );
}
```

- [ ] **Step 7: Add dashboard and meeting pages**

Write `app/dashboard/page.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { MeetingList } from "@/components/meeting-list";

const meetings = [
  {
    id: "meeting_1",
    title: "Pipeline review",
    platform: "google_meet" as const,
    startedAt: "2026-06-23T14:00:00.000Z",
    status: "ready" as const,
  },
  {
    id: "meeting_2",
    title: "Customer interview",
    platform: "zoom" as const,
    startedAt: "2026-06-23T16:00:00.000Z",
    status: "processing" as const,
  },
];

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Meetings</h1>
          <p className="mt-2 text-sm text-[#4d4d4d]">Search and review team transcripts.</p>
        </div>
        <a className="rounded-md bg-[#006bff] px-4 py-2 text-sm font-medium text-white" href="/meetings/new">
          Record
        </a>
      </div>
      <form className="mb-4">
        <input
          className="w-full rounded-md border border-[#eaeaea] px-3 py-2 text-sm"
          name="q"
          placeholder="Search transcripts"
        />
      </form>
      <MeetingList meetings={meetings} />
    </AppShell>
  );
}
```

Write `app/meetings/[meetingId]/page.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { ShareDialog } from "@/components/share-dialog";
import { TranscriptViewer } from "@/components/transcript-viewer";

const segments = [
  {
    id: "segment_1",
    speaker: "Alice",
    startMs: 0,
    text: "We need the transcript workflow to stay reliable before adding AI notes.",
  },
  {
    id: "segment_2",
    speaker: "Ben",
    startMs: 12000,
    text: "Internal attendees should get access automatically after the meeting is processed.",
  },
];

export default function MeetingDetailPage({
  params,
}: {
  params: { meetingId: string };
}) {
  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm text-[#4d4d4d]">Google Meet · ready</p>
        <h1 className="mt-2 text-2xl font-semibold">Pipeline review</h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <TranscriptViewer segments={segments} />
        <ShareDialog meetingId={params.meetingId} />
      </div>
    </AppShell>
  );
}
```

Write `app/meetings/new/page.tsx`:

```tsx
import { AppShell } from "@/components/app-shell";
import { UploadDropzone } from "@/components/upload-dropzone";

export default function NewMeetingPage() {
  return (
    <AppShell>
      <h1 className="text-2xl font-semibold">Record or upload</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form className="rounded-md border border-[#eaeaea] p-4">
          <label className="block text-sm font-medium" htmlFor="meetingUrl">
            Meeting link
          </label>
          <input
            className="mt-3 w-full rounded-md border border-[#eaeaea] px-3 py-2 text-sm"
            id="meetingUrl"
            name="meetingUrl"
            placeholder="Google Meet or Zoom link"
          />
          <button className="mt-4 rounded-md bg-[#006bff] px-4 py-2 text-sm font-medium text-white">
            Schedule bot
          </button>
        </form>
        <UploadDropzone />
      </div>
    </AppShell>
  );
}
```

Write `app/share/[token]/page.tsx`:

```tsx
import { TranscriptViewer } from "@/components/transcript-viewer";

const segments = [
  {
    id: "segment_1",
    speaker: "Speaker",
    startMs: 0,
    text: "Shared transcript access is scoped to this meeting only.",
  },
];

export default function SharedTranscriptPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-sm text-[#4d4d4d]">Shared transcript</p>
      <h1 className="mt-2 text-2xl font-semibold">Meeting transcript</h1>
      <div className="mt-6">
        <TranscriptViewer segments={segments} />
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Verify UI**

Run:

```bash
npm run test -- tests/search.test.ts
npm run build
```

Expected: unit test passes and build passes.

- [ ] **Step 9: Commit**

Run:

```bash
git add app components lib/search.ts tests/search.test.ts
git commit -m "feat: add transcript workspace ui"
```

## Task 8: Add End To End Verification And Documentation

**Files:**

1. Create: `tests/e2e/meeting-upload.spec.ts`
2. Create: `README.md`
3. Modify: `.env.example`
4. Modify: `docs/superpowers/specs/2026-06-23-otter-alternative-design.md` only if implementation choices drift from the approved design.

- [ ] **Step 1: Add Playwright test**

Write `tests/e2e/meeting-upload.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("user can open upload flow", async ({ page }) => {
  await page.goto("/meetings/new");
  await expect(page.getByText("Upload MP3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
});
```

- [ ] **Step 2: Add README**

Write `README.md`:

```md
# Meeting Transcript

Team meeting transcript product.

## Stack

1. Next.js on Vercel
2. Neon Auth for Google OAuth
3. Neon Postgres for product data
4. Cloudflare R2 for media
5. Recall.ai for Google Meet and Zoom capture
6. ElevenLabs for transcription
7. Inngest style workers for long running jobs

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Neon, R2, Recall, ElevenLabs, and Inngest credentials.
3. Run `npm install`.
4. Run `npm run dev`.

## Verification

Run:

```bash
npm run lint
npm run test
npm run build
npx playwright test
```
```

- [ ] **Step 3: Verify all checks**

Run:

```bash
npm run lint
npm run test
npm run build
npx playwright test
```

Expected: all checks pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md tests/e2e .env.example
git commit -m "docs: add setup and verification guide"
```

## Final Verification

Run:

```bash
git status --short
git log --oneline -8
```

Expected: working tree is clean and the recent commit history shows the scaffold, schema, auth, storage, adapters, workers, UI, and docs commits.
