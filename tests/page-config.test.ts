import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

describe("page rendering configuration", () => {
  it("renders dashboard dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/dashboard/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders meeting detail dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/meetings/[meetingId]/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders team settings dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/settings/team/page");

    expect(page.dynamic).toBe("force-dynamic");
  });
});
