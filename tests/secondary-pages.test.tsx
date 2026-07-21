import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  getMeeting: vi.fn(),
  getShared: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("REDIRECT"); }),
  requireUser: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/auth-guards", () => ({ requireCurrentUser: mocks.requireUser }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: mocks.workspace, getWorkspaceAccessSummary: mocks.access }));
vi.mock("@/lib/meeting-queries", () => ({ getMeetingTranscriptForWorkspace: mocks.getMeeting }));
vi.mock("@/lib/share-links", () => ({ getSharedTranscriptByToken: mocks.getShared }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/mobile-meeting-recorder", () => ({ MobileMeetingRecorder: ({ meetingTitle }: { meetingTitle: string }) => <span>recorder:{meetingTitle}</span> }));
vi.mock("@/components/meeting-link-form", () => ({ MeetingLinkForm: () => <span>link form</span> }));
vi.mock("@/components/upload-dropzone", () => ({ UploadDropzone: () => <span>upload dropzone</span> }));
vi.mock("@/components/transcript-viewer", () => ({ TranscriptViewer: () => <span>transcript viewer</span> }));

import MobileRecorderPage from "@/app/meetings/[meetingId]/record/page";
import NewMeetingPage from "@/app/meetings/new/page";
import SharedTranscriptPage from "@/app/share/[token]/page";

describe("secondary pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user" });
    mocks.workspace.mockResolvedValue({ teamId: "team", userId: "user" });
    mocks.access.mockResolvedValue({ canCreateMeetings: true });
  });

  it("renders the mobile recorder for a manageable meeting", async () => {
    mocks.getMeeting.mockResolvedValue({ canManage: true, id: "meeting", title: "Customer call" });
    const html = renderToStaticMarkup(await MobileRecorderPage({ params: Promise.resolve({ meetingId: "meeting" }) }));
    expect(html).toContain("Record this meeting");
    expect(html).toContain("recorder:Customer call");
  });

  it("rejects mobile recording without management access", async () => {
    mocks.getMeeting.mockResolvedValue({ canManage: false });
    await expect(MobileRecorderPage({ params: Promise.resolve({ meetingId: "meeting" }) })).rejects.toThrow("NOT_FOUND");
  });

  it("renders meeting creation and redirects read only users", async () => {
    const html = renderToStaticMarkup(await NewMeetingPage());
    expect(html).toContain("link form");
    expect(html).toContain("upload dropzone");
    mocks.access.mockResolvedValue({ canCreateMeetings: false });
    await expect(NewMeetingPage()).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("renders and validates shared transcript links", async () => {
    mocks.getShared.mockResolvedValue({ title: "Shared call", segments: [] });
    const html = renderToStaticMarkup(await SharedTranscriptPage({ params: Promise.resolve({ token: "token" }) }));
    expect(html).toContain("Shared call");
    expect(html).toContain("transcript viewer");
    mocks.getShared.mockResolvedValue(null);
    await expect(SharedTranscriptPage({ params: Promise.resolve({ token: "missing" }) })).rejects.toThrow("NOT_FOUND");
  });
});
