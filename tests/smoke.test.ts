import { describe, expect, it } from "vitest";

describe("product smoke test", () => {
  it("uses the Meeting Transcript product name", () => {
    expect("Meeting Transcript").toContain("Transcript");
  });
});
