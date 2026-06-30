import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const focusedOrSkippedTestPattern =
  /\b(?:describe|it|test)\.(?:only|skip)\s*\(/;

describe("test suite health", () => {
  it("does not leave focused or skipped tests committed", () => {
    const disabledTests = listTestFiles("tests")
      .filter((filePath) =>
        focusedOrSkippedTestPattern.test(readFileSync(filePath, "utf8")),
      )
      .map((filePath) => relative(process.cwd(), filePath));

    expect(disabledTests).toEqual([]);
  });
});

function listTestFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const filePath = join(directory, entry);
      const stats = statSync(filePath);

      if (stats.isDirectory()) {
        return listTestFiles(filePath);
      }

      return /\.(test|spec)\.[tj]sx?$/.test(entry) ? [filePath] : [];
    })
    .sort();
}
