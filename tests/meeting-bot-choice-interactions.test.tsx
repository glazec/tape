// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingLinkForm } from "@/components/meeting-link-form";

const choices = [
  { teamId: "company", teamName: "Company", organizationDomain: "first.test", botName: "First bot" },
  { teamId: "company", teamName: "Company", organizationDomain: "second.test", botName: "Second bot" },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("instant meeting bot choice", () => {
  it("asks before joining and sends the selected identity", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ code: "bot_organization_required", botChoices: choices }, 409)).mockResolvedValueOnce(json({ status: "joining" }));
    vi.stubGlobal("fetch", fetch);
    render(<MeetingLinkForm />);
    fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: "https://meet.google.com/abc-defg-hij" } });
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    await screen.findByRole("heading", { name: "Which bot should join?" });
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Second bot/ }));
    await screen.findByText("Bot joining");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ meetingUrl: "https://meet.google.com/abc-defg-hij", teamId: "company", organizationDomain: "second.test" });
  });
  it("cancels without dispatching a bot", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ code: "bot_organization_required", botChoices: choices }, 409));
    vi.stubGlobal("fetch", fetch);
    render(<MeetingLinkForm />);
    fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: "https://meet.google.com/abc-defg-hij" } });
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    await screen.findByRole("heading", { name: "Which bot should join?" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the bot selection through the nearby meeting confirmation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ code: "bot_organization_required", botChoices: choices }, 409))
      .mockResolvedValueOnce(json({ code: "potential_meetings_detected", potentialMeetings: [{ id: "calendar", kind: "calendar", action: "schedule", title: "Planning", startedAt: "2026-10-26T17:00:00Z", endedAt: null, timing: "current" }] }, 409))
      .mockResolvedValueOnce(json({ status: "joining" }));
    vi.stubGlobal("fetch", fetch);
    render(<MeetingLinkForm />);
    fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: "https://meet.google.com/abc-defg-hij" } });
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    fireEvent.click(await screen.findByRole("button", { name: /Second bot/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep separate" }));
    await screen.findByText("Bot joining");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ teamId: "company", organizationDomain: "second.test", createSeparateMeeting: true });
  });
});
