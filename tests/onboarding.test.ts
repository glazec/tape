import { describe, expect, it } from "vitest";

import { getConfiguredMcpServerAddress } from "@/lib/onboarding";

describe("getConfiguredMcpServerAddress", () => {
  it("builds the Streamable HTTP endpoint from the configured base URL", () => {
    expect(
      getConfiguredMcpServerAddress("https://mcp.example.com/"),
    ).toBe("https://mcp.example.com/mcp");
    expect(
      getConfiguredMcpServerAddress("https://mcp.example.com/mcp"),
    ).toBe("https://mcp.example.com/mcp");
  });

  it("allows a local development address", () => {
    expect(
      getConfiguredMcpServerAddress("http://127.0.0.1:8000"),
    ).toBe("http://127.0.0.1:8000/mcp");
  });

  it("hides missing or unsafe addresses", () => {
    expect(getConfiguredMcpServerAddress()).toBeNull();
    expect(
      getConfiguredMcpServerAddress("http://mcp.example.com"),
    ).toBeNull();
    expect(getConfiguredMcpServerAddress("not a URL")).toBeNull();
  });
});
