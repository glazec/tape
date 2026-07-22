// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/components/meeting-link-form", () => ({
  MeetingLinkForm: () => <span>Meeting link form</span>,
}));

vi.mock("@/components/upload-dropzone", () => ({
  UploadDropzone: () => <span>Recording upload form</span>,
}));

import { NewMeetingSources } from "@/components/new-meeting-sources";

describe("NewMeetingSources", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows four clear sources and reveals only the selected form", () => {
    render(<NewMeetingSources />);

    expect(screen.getByRole("button", { name: /Meeting link/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Recording file/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Transcript/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Record on phone/ })).toBeTruthy();
    expect(screen.queryByText("Meeting link form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Meeting link/ }));
    expect(screen.getByText("Meeting link form")).toBeTruthy();
    expect(screen.queryByText("Recording upload form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Recording file/ }));
    expect(screen.getByText("Recording upload form")).toBeTruthy();
    expect(screen.queryByText("Meeting link form")).toBeNull();
  });

  it("creates a meeting before opening the phone recorder", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ meetingId: "meeting_123" }), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    );
    render(<NewMeetingSources />);

    fireEvent.click(screen.getByRole("button", { name: /Record on phone/ }));
    fireEvent.change(screen.getByLabelText("Meeting title"), {
      target: { value: "Customer interview" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open phone recorder" }),
    );

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/meetings/manual",
        expect.objectContaining({ method: "POST" }),
      );
      expect(push).toHaveBeenCalledWith("/meetings/meeting_123/record");
    });
  });

  it("preserves transcript input and removes the draft when upload fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meetingId: "meeting_123" }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Transcript could not be parsed" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<NewMeetingSources />);
    fireEvent.click(screen.getByRole("button", { name: /Transcript/ }));
    const transcript = screen.getByLabelText("Transcript text");
    fireEvent.change(transcript, { target: { value: "Alice: Important notes" } });

    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));

    expect(await screen.findByText("Transcript could not be parsed")).toBeTruthy();
    expect((transcript as HTMLTextAreaElement).value).toBe(
      "Alice: Important notes",
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/api/meetings/meeting_123",
      { method: "DELETE" },
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("requires transcript content before creating a meeting", async () => {
    render(<NewMeetingSources />);
    fireEvent.click(screen.getByRole("button", { name: /Transcript/ }));

    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));

    expect(
      await screen.findByText("Paste transcript text or choose a transcript file"),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens the created meeting after adding transcript text", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ meetingId: "meeting_123" }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<NewMeetingSources />);
    fireEvent.click(screen.getByRole("button", { name: /Transcript/ }));
    fireEvent.change(screen.getByLabelText("Meeting title"), {
      target: { value: "Customer interview" },
    });
    fireEvent.change(screen.getByLabelText("Transcript text"), {
      target: { value: "Alice: Important notes" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add transcript" }));

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/meetings/meeting_123");
      expect(refresh).toHaveBeenCalledOnce();
    });
  });
});
