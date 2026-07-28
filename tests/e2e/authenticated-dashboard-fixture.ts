import { join } from "node:path";

export const authenticatedStorageStatePath = join(
  process.cwd(),
  "test-results",
  "playwright-auth",
  "dashboard-user.json",
);

export const authenticatedAdminStorageStatePath = join(
  process.cwd(),
  "test-results",
  "playwright-auth",
  "admin-user.json",
);

export const authenticatedDashboardFixture = {
  authUserId: "tape-e2e-dashboard-user",
  calendarConnectionId: "00000000-0000-4000-8000-000000000401",
  email: "dashboard.e2e@tape-ci.test",
  meetingId: "00000000-0000-4000-8000-000000000301",
  meetingTitle: "CI Dashboard Review",
  name: "Dashboard Tester",
  teamId: "00000000-0000-4000-8000-000000000201",
  teamName: "Tape CI",
  userId: "00000000-0000-4000-8000-000000000101",
} as const;

export const isolatedWorkspaceFixture = {
  authUserId: "tape-e2e-isolated-user",
  email: "private.e2e@other-ci.test",
  meetingId: "00000000-0000-4000-8000-000000000302",
  meetingTitle: "Other Workspace Secret",
  name: "Isolated Tester",
  teamId: "00000000-0000-4000-8000-000000000202",
  teamName: "Other Tape CI",
  userId: "00000000-0000-4000-8000-000000000102",
} as const;
