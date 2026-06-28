import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signOut: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe("AppShell", () => {
  it("places sign out outside the primary navigation", () => {
    const html = renderToStaticMarkup(<AppShell>Dashboard body</AppShell>);
    const primaryNav = html.slice(
      html.indexOf("<nav"),
      html.indexOf("</nav>"),
    );

    expect(html).toContain("Dashboard body");
    expect(html).toContain("Sign out");
    expect(primaryNav).toContain("Dashboard");
    expect(primaryNav).not.toContain("Sign out");
  });

  it("marks the active navigation item", () => {
    const html = renderToStaticMarkup(
      <AppShell activeHref="/dashboard">Dashboard body</AppShell>,
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders New meeting as the primary navigation action", () => {
    const html = renderToStaticMarkup(
      <AppShell activeHref="/dashboard">Dashboard body</AppShell>,
    );
    const newMeetingLink =
      html.match(/<a[^>]+href="\/meetings\/new"[^>]*>New meeting<\/a>/)?.[0] ??
      "";

    expect(newMeetingLink).toContain("bg-primary");
    expect(newMeetingLink).toContain("text-primary-foreground");
  });

  it("hides creator navigation for read only users", () => {
    const html = renderToStaticMarkup(
      <AppShell activeHref="/dashboard" canCreateMeetings={false}>
        Dashboard body
      </AppShell>,
    );

    expect(html).toContain("Dashboard");
    expect(html).not.toContain("New meeting");
    expect(html).not.toContain("Team settings");
  });
});
