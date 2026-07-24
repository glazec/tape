import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Vercel dashboard workflow", () => {
  it("syncs Inngest only after a production deployment is promoted", () => {
    const workflow = readFileSync(
      ".github/workflows/vercel-dashboard-check.yml",
      "utf8",
    );

    expect(workflow).toContain("- vercel.deployment.promoted");
    expect(workflow).toContain(
      "github.event.action == 'vercel.deployment.promoted' &&",
    );
    expect(workflow).toContain(
      "github.event.client_payload.environment == 'production'",
    );
    expect(workflow).toContain(
      "PRODUCTION_URL: https://tape.inevitable.tech",
    );
    expect(workflow).toContain("--request PUT");
    expect(workflow).toContain('"${PRODUCTION_URL%/}/api/inngest"');
    expect(workflow).toContain(
      '.message == "Successfully registered" and (.modified | type == "boolean")',
    );
  });
});
