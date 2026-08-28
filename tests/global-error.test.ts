// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException }));

describe("global error reporting", () => {
  beforeEach(() => {
    captureException.mockReset();
  });

  it("adds the boundary source and sanitized Next.js digest", async () => {
    const { captureGlobalError } = await import("@/app/global-error");
    const error = Object.assign(new Error("render failed"), {
      digest: "12345 alice@example.com",
    });

    captureGlobalError(error);

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        "error.boundary": "global",
        "error.source": "nextjs.global-error",
        "nextjs.error_digest": "12345 [redacted-email]",
      },
    });
  });
});
