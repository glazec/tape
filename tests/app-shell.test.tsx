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
});
