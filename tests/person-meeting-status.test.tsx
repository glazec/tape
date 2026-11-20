// @vitest-environment happy-dom

import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PersonMeetingList } from "@/components/person-meeting-list";
import type { PersonMeeting } from "@/lib/people";

it("distinguishes missing audio from a missing transcript and upcoming or private meetings", () => {
  const meeting: PersonMeeting = {
    id: "missed", title: "Missed call", at: "2026-11-01T00:00:00Z", status: "missed", hasRecording: false,
    canOpen: true, spoke: false, talkMs: 0, totalMs: 0, durationMs: 0, colleagues: [], ownerName: "Jordan",
  };
  render(<PersonMeetingList meetings={[
    { ...meeting, id: "next", title: "Next call", at: "2026-12-01T00:00:00Z", status: "scheduled" },
    meeting,
    { ...meeting, id: "processing", title: "Recorded call", status: "processing", hasRecording: true },
    { ...meeting, id: "private", title: "Locked call", status: null, canOpen: false },
  ]} nowIso="2026-11-19T00:00:00Z" viewerName="Jordan" />);
  expect(within(screen.getByRole("link", { name: /Missed call/ })).getByText("Missed · No recording")).toBeTruthy();
  expect(screen.getByText("Processing · Recording available")).toBeTruthy();
  expect(screen.getByText("Scheduled")).toBeTruthy();
  expect(screen.getByText("Private")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Locked call/ })).toBeNull();
});
