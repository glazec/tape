// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingList, type MeetingListItem } from "@/components/meeting-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

function meeting(id: string): MeetingListItem {
  return { id, title: id, platform: "zoom", status: "ready", startedAt: "2026-09-20T12:00:00Z" };
}

it("shows four meetings per folder including the parent and loads four more only in that folder", () => {
  render(<MeetingList meetings={[
    { ...meeting("Alpha"), relatedMeetings: Array.from({ length: 10 }, (_, i) => meeting(`Alpha ${i + 1}`)) },
    { ...meeting("Beta"), relatedMeetings: Array.from({ length: 6 }, (_, i) => meeting(`Beta ${i + 1}`)) },
  ]} />);
  expect(screen.getAllByRole("link")).toHaveLength(8);
  expect(screen.queryByRole("link", { name: "Alpha 4" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more meetings for Alpha" }));
  expect(screen.getAllByRole("link")).toHaveLength(12);
  expect(screen.getByRole("link", { name: "Alpha 7" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Beta 4" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more meetings for Alpha" }));
  expect(screen.getAllByRole("link")).toHaveLength(15);
  expect(screen.queryByRole("button", { name: "Load more meetings for Alpha" })).toBeNull();
});

describe("older meetings", () => {
  it.each([0, 1, 3])("does not fill empty slots with older history when %s recent children exist", (recentCount) => {
    render(<MeetingList meetings={[{
      ...meeting("Alpha"),
      relatedMeetings: Array.from({ length: recentCount }, (_, i) => meeting(`Recent ${i}`)),
      olderRelatedMeetings: [meeting("Older meeting")],
      hasMoreRelatedMeetings: true,
    }]} />);
    expect(screen.getAllByRole("link")).toHaveLength(recentCount + 1);
    expect(screen.queryByRole("link", { name: "Older meeting" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more meetings for Alpha" }));
    expect(screen.getByRole("link", { name: "Older meeting" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more meetings for Alpha" })).toBeNull();
  });
});
