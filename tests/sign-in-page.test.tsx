// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { social } = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signIn: { social } } }));

import SignInPage from "@/app/auth/sign-in/page";
import { SignInForm } from "@/app/auth/sign-in/sign-in-form";

describe("sign in page", () => {
  beforeEach(() => social.mockReset());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders workspace guidance and uses the first callback URL", async () => {
    const page = await SignInPage({ searchParams: Promise.resolve({ callbackUrl: ["/meetings/one", "/ignored"] }) });
    render(page);
    expect(screen.getByRole("heading", { name: "Sign in to Tape." })).toBeTruthy();
    expect(
      screen.getByText(
        /Use your company Google account|Recordings and transcripts stay/,
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Tape home|Back to site/ })).toHaveLength(2);
  });

  it("starts Google sign in with the requested callback", async () => {
    social.mockResolvedValue({ error: null });
    render(<SignInForm callbackUrl="/meetings/one" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    });
    expect(await screen.findByRole("button", { name: "Opening Google…" })).toBeTruthy();
    expect(social).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: "/meetings/one" }));
  });

  it("shows provider errors and allows another attempt", async () => {
    social.mockResolvedValue({ error: { message: "Account is not allowed" } });
    render(<SignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Account is not allowed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

});
