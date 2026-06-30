import { describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };

describe("package scripts", () => {
  it("exposes the verification and deploy commands used by the repo", () => {
    expect(packageJson.scripts).toMatchObject({
      build: "next build",
      "db:migrate": "drizzle-kit migrate --config=drizzle.config.ts",
      lint: "eslint",
      test: "vitest run",
      "test:e2e": "playwright test",
    });
  });
});
