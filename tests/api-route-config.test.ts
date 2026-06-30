import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

describe("API route configuration", () => {
  it("pins API route handlers to the Node runtime", () => {
    const missingNodeRuntime = listRouteFiles("app/api")
      .map((filePath) => ({
        filePath,
        source: readFileSync(filePath, "utf8"),
      }))
      .filter(
        ({ source }) => !source.includes('export const runtime = "nodejs"'),
      )
      .map(({ filePath }) => relative(process.cwd(), filePath));

    expect(missingNodeRuntime).toEqual([]);
  });
});

function listRouteFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const filePath = join(directory, entry);
      const stats = statSync(filePath);

      if (stats.isDirectory()) {
        return listRouteFiles(filePath);
      }

      return entry === "route.ts" ? [filePath] : [];
    })
    .sort();
}
