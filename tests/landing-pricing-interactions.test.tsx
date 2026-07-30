// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LandingPricing } from "@/components/landing/landing-pricing";

describe("LandingPricing assumption interactions", () => {
  it("keeps the sharing assumption visible and valid when team size shrinks", () => {
    render(<LandingPricing />);

    const sharingInput = screen.getByLabelText(
      "Tape users sharing each meeting",
    ) as HTMLInputElement;
    const teamInput = screen.getByLabelText(
      "Team members using Tape",
    ) as HTMLInputElement;

    fireEvent.change(sharingInput, { target: { value: "8" } });
    fireEvent.blur(sharingInput);
    expect(sharingInput.value).toBe("8");

    fireEvent.change(teamInput, { target: { value: "2" } });
    fireEvent.blur(teamInput);

    expect(teamInput.value).toBe("2");
    expect(sharingInput.value).toBe("2");
  });
});
