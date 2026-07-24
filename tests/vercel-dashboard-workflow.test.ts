import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Vercel dashboard workflow", () => {
  it("syncs Inngest only for production deployments", () => {
    const workflow = readFileSync(
      ".github/workflows/vercel-dashboard-check.yml",
      "utf8",
    );

    expect(workflow).toContain(
      "if: github.event.client_payload.environment == 'production'",
    );
    expect(workflow).toContain("--request PUT");
    expect(workflow).toContain('"${DEPLOYMENT_URL%/}/api/inngest"');
  });
});
