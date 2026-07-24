// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CopyMcpAddressButton } from "@/components/copy-mcp-address-button";

describe("CopyMcpAddressButton", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies the MCP address and confirms success", async () => {
    render(<CopyMcpAddressButton address="https://mcp.example.com/mcp" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    expect(await screen.findByText("MCP address copied.")).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://mcp.example.com/mcp",
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("reports clipboard failures", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Clipboard unavailable"),
    );
    render(<CopyMcpAddressButton address="https://mcp.example.com/mcp" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    expect(
      await screen.findByText("Could not copy the MCP address."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Could not copy" }),
    ).toBeTruthy();
  });
});
