import { authenticatedDashboardFixture } from "./authenticated-dashboard-fixture";

export const publicPageRenderHeadings = {
  "/": "It’s all on Tape.",
  "/auth/sign-in": "Sign in to Tape.",
  "/blog": "Notes for meetings that keep working.",
  "/privacy": "Your meetings remain your record.",
  "/terms": "A shared record needs shared responsibility.",
} as const;

export const authenticatedPageRenderHeadings = {
  "/intel": "Who should know?",
  [`/meetings/${authenticatedDashboardFixture.meetingId}`]:
    authenticatedDashboardFixture.meetingTitle,
  [`/meetings/${authenticatedDashboardFixture.meetingId}/record`]:
    "Record this meeting",
  "/meetings/new": "Add a meeting",
  "/settings/team": "Settings",
  "/usage": "Billing & credits",
} as const;

export const protectedPageRedirectRoutes = ["/people/smoke-test-value"] as const;

export const adminPageRenderHeading = "User view control";

export const pageRenderContractRoutes = [
  ...Object.keys(publicPageRenderHeadings),
  ...Object.keys(authenticatedPageRenderHeadings),
  ...protectedPageRedirectRoutes,
  "/admin",
  "/blog/smoke-test-value",
  "/dashboard",
].sort();
