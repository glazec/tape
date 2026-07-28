import { neon } from "@neondatabase/serverless";

import {
  authenticatedDashboardFixture,
  isolatedWorkspaceFixture,
} from "../tests/e2e/authenticated-dashboard-fixture";

const databaseUrl = requireE2EDatabaseUrl(process.env.DATABASE_URL);
const sql = neon(databaseUrl);

async function main() {
  await sql.transaction([
    sql`
    delete from teams
    where id in (
      ${authenticatedDashboardFixture.teamId}::uuid,
      ${isolatedWorkspaceFixture.teamId}::uuid
    )
  `,
    sql`
    delete from users
    where id in (
      ${authenticatedDashboardFixture.userId}::uuid,
      ${isolatedWorkspaceFixture.userId}::uuid
    )
  `,
    sql`
    insert into users (id, auth_user_id, email, name)
    values
      (
        ${authenticatedDashboardFixture.userId}::uuid,
        ${authenticatedDashboardFixture.authUserId},
        ${authenticatedDashboardFixture.email},
        ${authenticatedDashboardFixture.name}
      ),
      (
        ${isolatedWorkspaceFixture.userId}::uuid,
        ${isolatedWorkspaceFixture.authUserId},
        ${isolatedWorkspaceFixture.email},
        ${isolatedWorkspaceFixture.name}
      )
  `,
    sql`
    insert into teams (id, name, credit_limit_usd_micros)
    values
      (
        ${authenticatedDashboardFixture.teamId}::uuid,
        ${authenticatedDashboardFixture.teamName},
        5000000
      ),
      (
        ${isolatedWorkspaceFixture.teamId}::uuid,
        ${isolatedWorkspaceFixture.teamName},
        5000000
      )
  `,
    sql`
    insert into team_memberships (team_id, user_id, role)
    values
      (
        ${authenticatedDashboardFixture.teamId}::uuid,
        ${authenticatedDashboardFixture.userId}::uuid,
        'owner'
      ),
      (
        ${isolatedWorkspaceFixture.teamId}::uuid,
        ${isolatedWorkspaceFixture.userId}::uuid,
        'owner'
      )
  `,
    sql`
    insert into calendar_connections (
      id,
      team_id,
      user_id,
      provider,
      external_calendar_id,
      auto_join_enabled,
      recall_calendar_id,
      recall_calendar_status,
      recall_calendar_last_synced_at
    )
    values (
      ${authenticatedDashboardFixture.calendarConnectionId}::uuid,
      ${authenticatedDashboardFixture.teamId}::uuid,
      ${authenticatedDashboardFixture.userId}::uuid,
      'google',
      ${authenticatedDashboardFixture.email},
      false,
      'tape-ci-calendar',
      'connected',
      now()
    )
  `,
    sql`
    insert into meetings (
      id,
      team_id,
      owner_user_id,
      title,
      title_source,
      platform,
      status,
      started_at,
      ended_at
    )
    values
      (
        ${authenticatedDashboardFixture.meetingId}::uuid,
        ${authenticatedDashboardFixture.teamId}::uuid,
        ${authenticatedDashboardFixture.userId}::uuid,
        ${authenticatedDashboardFixture.meetingTitle},
        'manual',
        'google_meet',
        'ready',
        now(),
        now()
      ),
      (
        ${isolatedWorkspaceFixture.meetingId}::uuid,
        ${isolatedWorkspaceFixture.teamId}::uuid,
        ${isolatedWorkspaceFixture.userId}::uuid,
        ${isolatedWorkspaceFixture.meetingTitle},
        'manual',
        'zoom',
        'ready',
        now(),
        now()
      )
    `,
  ]);

  console.log("Seeded authenticated dashboard E2E fixtures.");
}

function requireE2EDatabaseUrl(value: string | undefined) {
  if (!value) {
    throw new Error("DATABASE_URL is required");
  }

  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));

  if (databaseName !== "tape_ci") {
    throw new Error(
      `Refusing to seed database ${JSON.stringify(databaseName)}; expected "tape_ci"`,
    );
  }

  return value;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
