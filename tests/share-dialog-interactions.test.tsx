// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareDialog } from "@/components/share-dialog";

const props = {
  customAudience: {
    memberCount: 2,
    name: "Investment committee",
  },
  initialAccessPeople: [{ email: "participant@example.com", name: "Participant" }],
  initialShares: [],
  instanceId: "interaction",
  meetingId: "meeting/one",
  teamMembers: [{ email: "teammate@example.com", name: "Team Mate" }],
};

describe("ShareDialog interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shares one meeting and refreshes the access list", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ email: "guest@example.com" }))
      .mockResolvedValueOnce(response({ shares: [] }));
    render(<ShareDialog {...props} />);

    changeRecipient("guest@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));

    expect(await screen.findByText("Shared with guest@example.com.")).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/meetings/meeting%2Fone/share",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("previews related meetings before confirming", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({
        email: "guest@example.com",
        meetingCount: 2,
        meetings: [{ id: "one", title: "First meeting" }, { id: "two", title: "Second meeting" }],
      }))
      .mockResolvedValueOnce(response({ email: "guest@example.com", futureMeetings: true, meetingCount: 2 }))
      .mockResolvedValueOnce(response({ shares: [] }));
    render(<ShareDialog {...props} />);

    changeRecipient("guest@example.com");
    fireEvent.click(screen.getByLabelText("Include past and future related meetings"));
    fireEvent.click(screen.getByRole("button", { name: "Review share" }));

    expect(await screen.findByText("Share 2 meetings?")).toBeTruthy();
    expect(screen.getByText("First meeting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Future related meetings are included/)).toBeTruthy();
  });

  it("shares with organization and reports audience failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ recipientCount: 4 }))
      .mockResolvedValueOnce(response({ shares: [] }));
    const { unmount } = render(<ShareDialog {...props} />);
    changeRecipient("Whole organization");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));
    expect(await screen.findByText("Shared with 4 organization members.")).toBeTruthy();
    unmount();

    vi.mocked(fetch).mockReset().mockResolvedValueOnce(response({ error: "Audience unavailable" }, 503));
    render(<ShareDialog {...props} />);
    changeRecipient("Investment committee");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Audience unavailable");
  });

  it("removes access and distinguishes unauthorized failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ shares: [] }));
    const { unmount } = render(<ShareDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove participant@example.com" }));
    expect(await screen.findByText("Access removed.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("participant@example.com")).toBeNull());
    unmount();

    vi.mocked(fetch).mockReset().mockResolvedValueOnce(response({}, 401));
    render(<ShareDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove participant@example.com" }));
    expect(await screen.findByText("Sign in to manage access.")).toBeTruthy();
  });

  it("shows response and network errors without clearing the recipient", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "Unknown colleague" }, 400));
    const { unmount } = render(<ShareDialog {...props} />);
    changeRecipient("guest@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));
    expect(await screen.findByText("Unknown colleague")).toBeTruthy();
    unmount();

    vi.mocked(fetch).mockReset().mockRejectedValueOnce(new Error("network"));
    render(<ShareDialog {...props} />);
    changeRecipient("guest@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));
    expect(await screen.findByText("Could not share right now. Try again.")).toBeTruthy();
  });
});

function changeRecipient(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
