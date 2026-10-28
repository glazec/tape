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
  it("renders the Tape lockup instead of the MT placeholder", () => {
    const html = renderToStaticMarkup(<AppShell>Dashboard body</AppShell>);

    expect(html).toContain("tape-lockup.svg");
    expect(html).toContain('aria-label="Tape home"');
    expect(html).not.toContain(">MT<");
  });

  it("places sign out outside the primary navigation", () => {
    const html = renderToStaticMarkup(<AppShell>Dashboard body</AppShell>);
    const primaryNav = html.slice(
      html.indexOf("<nav"),
      html.indexOf("</nav>"),
    );

    expect(html).toContain("Dashboard body");
    expect(html).toContain("Sign out");
    expect(html).toContain("Setup guide");
    expect(html).toContain('href="/dashboard?setup=1"');
    expect(primaryNav).toContain("Meetings");
    expect(primaryNav).not.toContain("Setup guide");
    expect(primaryNav).not.toContain("Sign out");
    expect(primaryNav).not.toContain("Usage");
  });

  it("marks the active navigation item", () => {
    const html = renderToStaticMarkup(
      <AppShell activeHref="/dashboard">Dashboard body</AppShell>,
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders New meeting as a primary action outside the tabs", () => {
    const html = renderToStaticMarkup(
      <AppShell activeHref="/dashboard">Dashboard body</AppShell>,
    );
    const newMeetingLink =
      html.match(/<a[^>]+href="\/meetings\/new"[^>]*>.*?New meeting.*?<\/a>/)?.[0] ??
      "";
    const primaryNav = html.slice(
      html.indexOf("<nav"),
      html.indexOf("</nav>"),
    );

    expect(newMeetingLink).toContain("bg-primary");
    expect(newMeetingLink).toContain("text-primary-foreground");
    expect(primaryNav).toContain('href="/dashboard"');
    expect(primaryNav).not.toContain('href="/meetings/new"');
  });

  it("hides creator navigation for read only users", () => {
    const html = renderToStaticMarkup(
      <AppShell activeHref="/dashboard" canCreateMeetings={false}>
        Dashboard body
      </AppShell>,
    );

    expect(html).toContain("Meetings");
    expect(html).not.toContain("New meeting");
    expect(html).not.toContain("Setup guide");
    expect(html).not.toContain('href="/settings/team"');
  });
});
