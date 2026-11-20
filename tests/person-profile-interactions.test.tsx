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
});
