// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth-guards", () => ({ requireCurrentUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: async () => ({ teamId: "team", userId: "user" }),
  getWorkspaceAccessSummary: async () => ({ canCreateMeetings: true }),
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/meeting-link-form", () => ({ MeetingLinkForm: () => <div>Meeting link form</div> }));
vi.mock("@/components/upload-dropzone", () => ({ UploadDropzone: () => <div>Recording upload form</div> }));
import NewMeetingPage from "@/app/meetings/new/page";
afterEach(cleanup);
it("applies a new source shortcut while already on the creation page", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const view = render(await NewMeetingPage({ searchParams: Promise.resolve({ source: "link" }) }));
  expect(screen.getByText("Meeting link form")).toBeTruthy();
  view.rerender(await NewMeetingPage({ searchParams: Promise.resolve({ source: "recording" }) }));
  expect(screen.getByText("Recording upload form")).toBeTruthy();
  expect(screen.queryByText("Meeting link form")).toBeNull();
});
