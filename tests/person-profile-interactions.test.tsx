// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PersonProfile } from "@/components/person-profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens a person with no saved AI profile without generating one", async () => {
  const fetch = vi.fn(async () => Response.json({ status: "no_meetings" }));
  vi.stubGlobal("fetch", fetch);
  render(<PersonProfile initialProfile={null} personId="person-id" personName="Tara" />);

  expect(screen.getByText("No profile yet.")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  expect(fetch).toHaveBeenCalledWith("/api/people/person-id/profile", { method: "POST" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy());
});
