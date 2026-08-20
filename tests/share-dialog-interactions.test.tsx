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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shares one meeting and refreshes the access list", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ email: "sid@iosg.vc", pending: true }))
      .mockResolvedValueOnce(response({ shares: [] }));
    render(<ShareDialog {...props} />);

    changeRecipient("sid@iosg.vc");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));

    const toast = await screen.findByRole("status");
    expect(toast.textContent).toBe(
      "Invite saved for sid@iosg.vc. Meeting link copied.",
    );
    expect(toast.className).toContain("fixed");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/meetings/meeting%2Fone`,
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/meetings/meeting%2Fone/share",
      expect.objectContaining({
        body: JSON.stringify({
          email: "sid@iosg.vc",
          includeRelated: false,
          preview: false,
        }),
        method: "POST",
      }),
    );
  });

  it("submits the visible recipient when browser input and state diverge", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ email: "sid@iosg.vc", pending: true }))
      .mockResolvedValueOnce(response({ shares: [] }));
    render(<ShareDialog {...props} />);

    const input = screen.getByRole("combobox") as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, "sid@iosg.vc");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));

    await screen.findByRole("status");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/meetings/meeting%2Fone/share",
      expect.objectContaining({
        body: JSON.stringify({
          email: "sid@iosg.vc",
          includeRelated: false,
          preview: false,
        }),
      }),
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
    const input = screen.getByRole("combobox");
    const relatedScope = screen.getByLabelText(
      "Include past and future related meetings",
    );
    fireEvent.pointerDown(relatedScope, { pointerType: "touch" });
    fireEvent.click(relatedScope);
    expect((input as HTMLInputElement).value).toBe("guest@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Review share" }));

    expect(await screen.findByText("Share 2 meetings?")).toBeTruthy();
    expect(screen.getByText("First meeting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Future related meetings are included/)).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("allows a recipient draft to be cleared by typing", () => {
    render(<ShareDialog {...props} />);

    const input = screen.getByRole("combobox");
    changeRecipient("guest@example.com");
    fireEvent.input(input, {
      inputType: "deleteContentBackward",
      target: { value: "" },
    });

    expect((input as HTMLInputElement).value).toBe("");
  });

  it("shares with organization and reports audience failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ recipientCount: 4 }))
      .mockResolvedValueOnce(response({ shares: [] }));
    const { unmount } = render(<ShareDialog {...props} />);
    changeRecipient("Whole organization");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));
    expect(
      await screen.findByText(
        "Shared with 4 organization members. Meeting link copied.",
      ),
    ).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
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

  it("revokes a related policy before removing current meeting access", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ revoked: true }))
      .mockResolvedValueOnce(response({ revoked: true }))
      .mockResolvedValueOnce(response({ shares: [] }));
    render(
      <ShareDialog
        {...props}
        initialShares={[
          {
            email: "guest@example.com",
            id: "55555555-5555-4555-8555-555555555555",
            pending: false,
            scope: "related",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove guest@example.com" }));

    expect(await screen.findByText("Access removed.")).toBeTruthy();
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/meetings/meeting%2Fone/share?shareId=55555555-5555-4555-8555-555555555555",
      { method: "DELETE" },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/meetings/meeting%2Fone/share?email=guest%40example.com",
      { method: "DELETE" },
    );
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

  it("reports a successful share when clipboard access is unavailable", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("clipboard denied"),
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ email: "guest@example.com" }))
      .mockResolvedValueOnce(response({ shares: [] }));
    render(<ShareDialog {...props} />);

    changeRecipient("guest@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Share meeting" }));

    expect(
      await screen.findByText(
        "Shared with guest@example.com. Could not copy the meeting link.",
      ),
    ).toBeTruthy();
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
