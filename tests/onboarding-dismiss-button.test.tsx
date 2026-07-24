// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingDismissButton } from "@/components/onboarding-dismiss-button";
import { getOnboardingHiddenCookieName } from "@/lib/onboarding";

const replace = vi.fn();
const cookieName = getOnboardingHiddenCookieName({
  teamId: "team_123",
  userId: "user_123",
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("OnboardingDismissButton", () => {
  beforeEach(() => {
    document.cookie = `${cookieName}=; Max-Age=0; Path=/`;
    replace.mockReset();
  });

  it("persists dismissal and returns to the dashboard", () => {
    render(<OnboardingDismissButton cookieName={cookieName} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide tutorial" }));

    expect(document.cookie).toContain(`${cookieName}=1`);
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });
});
