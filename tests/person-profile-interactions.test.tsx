// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PersonProfile } from "@/components/person-profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("automatically requests a missing profile and allows retry after speaker attribution", async () => {
  const fetch = vi.fn(async () => Response.json({ status: "no_meetings" }));
  vi.stubGlobal("fetch", fetch);
  render(<PersonProfile initialProfile={null} personId="person-id" personName="Tara" />);

  await screen.findByText(/link Tara to their speaker label/);
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(fetch).toHaveBeenCalledWith("/api/people/person-id/profile", { method: "POST" });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

it("shows the generated profile on the page and reuses a saved profile on the next visit", async () => {
  const unknown = { level: "unclear" as const, summary: "", sources: [] };
  const profile = {
    profile: { version: 1 as const, headline: "Builds laboratory software.", role: [], background: [], achievements: [],
      recentFocus: [], sources: {}, expertise: { technical: unknown, operational: unknown, business: unknown, social: unknown } },
    generatedAt: "2026-11-01T12:00:00Z", sourceMeetings: [],
  };
  const fetch = vi.fn(async () => Response.json({ status: "ready", profile }));
  vi.stubGlobal("fetch", fetch);
  const view = render(<PersonProfile initialProfile={null} personId="one" personName="Simon" />);
  expect(await screen.findByText(profile.profile.headline)).toBeTruthy();
  view.unmount();
  render(<PersonProfile initialProfile={profile} personId="one" personName="Simon" />);
  expect(screen.getByText(profile.profile.headline)).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(Response.json({ status: "no_meetings" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText(/Could not refresh this profile/)).toBeTruthy();
  expect(screen.getByText(profile.profile.headline)).toBeTruthy();
});

it("shows one current project with cited history and reports remaining meetings after refresh", async () => {
  const unknown = { level: "unclear" as const, summary: "", sources: [] };
  const current = { meetingId: "later", segmentId: "beta", at: "2026-03-01T12:00:00Z", summary: "Opened a private beta.", state: "active" as const };
  const first = { meetingId: "first", segmentId: "start", at: "2026-01-01T12:00:00Z", summary: "Started the SDK.", state: "active" as const };
  const profile = {
    generatedAt: "2026-03-05T12:00:00Z", sourceMeetings: [],
    profile: {
      version: 1 as const, headline: "Builds SDKs.", role: [], background: [], achievements: [], sources: {},
      recentFocus: [{ text: "Opened a private beta.", sources: [] }],
      expertise: { technical: unknown, operational: unknown, business: unknown, social: unknown },
    },
  };
  const timeline = [{
    id: "project:harbor", title: "Harbor", category: "project" as const, current, lastMention: current,
    firstObserved: first.at, lastConfirmed: current.at, milestones: [first, current],
  }];
  const fetch = vi.fn(async () => Response.json({ status: "ready", profile, timeline, timelineRemaining: 2 }));
  vi.stubGlobal("fetch", fetch);
  render(<PersonProfile initialProfile={profile} initialTimeline={timeline} personId="one" personName="Tara" />);

  expect(screen.getAllByText(current.summary)).toHaveLength(1);
  expect(screen.getByText("History · 1 update")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: /Source/ }).map(link => link.getAttribute("href")))
    .toContain("/meetings/later?view=transcript#beta");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText("2 more meetings to review. Use Refresh to continue.")).toBeTruthy();
});
