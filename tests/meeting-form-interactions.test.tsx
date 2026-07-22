// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, replace } = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: vi.fn() } }));

import { MeetingLinkForm } from "@/components/meeting-link-form";
import { MeetingTitleEditor } from "@/components/meeting-title-editor";
import { SignOutButton, signOutSession } from "@/components/sign-out-button";

describe("meeting form interactions", () => {
  beforeEach(() => {
    refresh.mockReset();
    replace.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("validates and schedules meeting links", async () => {
    const { unmount } = render(<MeetingLinkForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    expect(await screen.findByText("Enter a Google Meet or Zoom link")).toBeTruthy();
    unmount();

    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "joining" }));
    render(<MeetingLinkForm />);
    fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: "https://meet.google.com/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    expect(await screen.findByText("The bot should appear within about 30 seconds.")).toBeTruthy();
  });

  it("asks before attaching a replacement link to the current meeting", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json(
          {
            code: "meeting_recovery_available",
            recoveryMeeting: {
              id: "11111111-1111-4111-8111-111111111111",
              startedAt: "2026-07-22T12:00:00.000Z",
              title: "Founder call",
            },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(json({ status: "joining" }));

    render(<MeetingLinkForm />);
    fillLink();
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));

    expect(
      await screen.findByRole("dialog", {
        name: "Send bot to Founder call?",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/Started/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Send bot to this meeting" }),
    );

    expect(
      await screen.findByText("The bot should appear within about 30 seconds."),
    ).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/meetings/link",
      expect.objectContaining({
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/abc",
          recoveryMeetingId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });

  it("closes the recovery choice with Escape and restores focus", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        {
          code: "meeting_recovery_available",
          recoveryMeeting: {
            id: "11111111-1111-4111-8111-111111111111",
            startedAt: "2026-07-22T12:00:00.000Z",
            title: "Founder call",
          },
        },
        409,
      ),
    );

    render(<MeetingLinkForm />);
    fillLink();
    const submitButton = screen.getByRole("button", {
      name: "Add meeting bot",
    });
    submitButton.focus();
    fireEvent.click(submitButton);
    await screen.findByRole("dialog", { name: "Send bot to Founder call?" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(document.activeElement).toBe(submitButton);
  });

  it("shows authorization, join, and network errors for meeting links", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 401));
    const { unmount } = render(<MeetingLinkForm />);
    fillLink();
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    unmount();

    vi.mocked(fetch).mockReset().mockResolvedValueOnce(json({ error: "Bot failed to join call" }, 400));
    const second = render(<MeetingLinkForm />);
    fillLink();
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    expect(await screen.findByText("Bot could not join. Try again.")).toBeTruthy();
    second.unmount();

    vi.mocked(fetch).mockReset().mockRejectedValueOnce(new Error("network"));
    render(<MeetingLinkForm />);
    fillLink();
    fireEvent.click(screen.getByRole("button", { name: "Add meeting bot" }));
    expect(await screen.findByText("Meeting bot could not be scheduled")).toBeTruthy();
  });

  it("validates, cancels, saves, and reports title rename failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<MeetingTitleEditor meetingId="meeting/one" meetingTitle="Original" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename meeting" }));
    fireEvent.change(screen.getByLabelText("Meeting title"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save meeting title" }));
    expect(await screen.findByText("Meeting title cannot be empty.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Meeting title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save meeting title" }));
    expect(await screen.findByText("Could not rename this meeting.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save meeting title" }));
    expect(await screen.findByText("Changed")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("cancels unchanged title edits without a request", () => {
    render(<MeetingTitleEditor meetingId="meeting" meetingTitle="Original" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(screen.getByText("Original")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rename meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "Save meeting title" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs out, clears local cookies, and redirects", async () => {
    const authClient = { signOut: vi.fn().mockResolvedValue({ error: null }) };
    await expect(signOutSession({ authClient, clearLocalCookies: vi.fn().mockResolvedValue(new Response(null, { status: 500 })) })).resolves.toEqual({ ok: true });

    const authModule = await import("@/lib/auth/client");
    vi.mocked(authModule.authClient.signOut).mockResolvedValue({ error: null });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("button", { name: "Signing out" });
    expect(replace).toHaveBeenCalledWith("/auth/sign-in");
    expect(refresh).toHaveBeenCalled();
  });
});

function fillLink() {
  fireEvent.change(screen.getByLabelText("Meeting link"), { target: { value: "https://meet.google.com/abc" } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
