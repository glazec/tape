import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };

describe("package scripts", () => {
  it("exposes the verification and deploy commands used by the repo", () => {
    expect(packageJson.scripts).toMatchObject({
      build: "next build",
      "db:migrate": "drizzle-kit migrate --config=drizzle.config.ts",
      lint: "eslint",
      test: "vitest run",
      "test:calendar-live": expect.stringContaining(
        "scripts/verify-calendar-connection.ts",
      ),
      "test:coverage": "vitest run --coverage",
      "test:e2e": "playwright test",
      "test:mcp": expect.stringContaining("python -m unittest"),
      "test:sidecar": "npm --prefix mac/LocalRecorder/Sidecar test",
      "test:swift": "swift test --package-path mac/LocalRecorder",
      verify: expect.stringContaining("npm run test:coverage"),
      "verify:all": expect.stringContaining("npm run test:e2e"),
    });
  });
});
