import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("RLS privilege boundary", () => {
  it("keeps the administrative database client out of user request code", () => {
    const privilegedImports = ["app", "db", "inngest", "lib", "scripts"]
      .flatMap(listTypeScriptFiles)
      .filter((file) => readFileSync(file, "utf8").includes("privilegedDb"))
      .sort();

    expect(privilegedImports).toEqual([
      "db/client.ts",
      "lib/admin-access.ts",
      "lib/request-rate-limit.ts",
    ]);
  });
});

function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return /\.[cm]?tsx?$/.test(entry.name) ? [path] : [];
  });
}
