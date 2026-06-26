import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SignOutButton, signOutSession } from "@/components/sign-out-button";

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

describe("SignOutButton", () => {
  it("renders a button action for signing out", () => {
    const html = renderToStaticMarkup(<SignOutButton />);

    expect(html).toContain('type="button"');
    expect(html).toContain("Sign out");
  });

  it("uses the auth client and accepts local cookie cleanup when provider sign out fails", async () => {
    const authClient = {
      signOut: vi.fn().mockResolvedValue({
        error: { code: "FORBIDDEN", message: "Forbidden" },
      }),
    };
    const clearLocalCookies = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      signOutSession({ authClient, clearLocalCookies }),
    ).resolves.toEqual({ ok: true });

    expect(authClient.signOut).toHaveBeenCalled();
    expect(clearLocalCookies).toHaveBeenCalled();
  });
});
