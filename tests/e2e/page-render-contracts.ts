import { authenticatedDashboardFixture } from "./authenticated-dashboard-fixture";

export const publicPageRenderHeadings = {
  "/": "Every conversation, on the record.",
  "/auth/sign-in": "Sign in to Tape.",
  "/blog": "Notes for meetings that keep working.",
  "/privacy": "Your meetings remain your record.",
  "/terms": "A shared record needs shared responsibility.",
} as const;

export const authenticatedPageRenderHeadings = {
  [`/meetings/${authenticatedDashboardFixture.meetingId}`]:
    authenticatedDashboardFixture.meetingTitle,
  [`/meetings/${authenticatedDashboardFixture.meetingId}/record`]:
    "Record this meeting",
  "/meetings/new": "Add a meeting",
  "/settings/team": authenticatedDashboardFixture.teamName,
  "/usage": "Billing & credits",
} as const;

export const adminPageRenderHeading = "User view control";

export const pageRenderContractRoutes = [
  ...Object.keys(publicPageRenderHeadings),
  ...Object.keys(authenticatedPageRenderHeadings),
  "/admin",
  "/blog/smoke-test-value",
  "/dashboard",
].sort();
