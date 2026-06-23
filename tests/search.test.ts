import { describe, expect, it } from "vitest";

import {
  buildPostgresTsQuery,
  buildTranscriptFullTextSearchQuery,
  buildTranscriptSearchQuery,
} from "@/lib/search";

describe("buildTranscriptSearchQuery", () => {
  it("normalizes a transcript search phrase into lowercase tokens", () => {
    expect(buildTranscriptSearchQuery("  budget review  ")).toEqual([
      "budget",
      "review",
    ]);
  });
});

describe("buildPostgresTsQuery", () => {
  it("returns an empty query for empty input", () => {
    expect(buildPostgresTsQuery("   ")).toBe("");
  });

  it("normalizes multi word input for websearch_to_tsquery", () => {
    expect(buildPostgresTsQuery("Budget Review Followup")).toBe(
      "budget review followup",
    );
  });

  it("removes punctuation that should not reach websearch_to_tsquery syntax", () => {
    expect(buildPostgresTsQuery("Q3: budget, review!")).toBe(
      "q3 budget review",
    );
  });
});

describe("buildTranscriptFullTextSearchQuery", () => {
  it("returns null for empty input", () => {
    expect(buildTranscriptFullTextSearchQuery("  ")).toBeNull();
  });

  it("builds a parameterized full text search query", () => {
    expect(buildTranscriptFullTextSearchQuery("Budget Review")).toEqual({
      sql: expect.stringContaining("websearch_to_tsquery('english', $1)"),
      params: ["budget review"],
    });
  });

  it("uses the indexed meeting and transcript expressions", () => {
    const query = buildTranscriptFullTextSearchQuery("Q3: budget!")?.sql;

    expect(query).toContain("coalesce(m.title, '')");
    expect(query).toContain("coalesce(m.meeting_url, '')");
    expect(query).toContain("coalesce(ts.text, '')");
    expect(query).toContain("coalesce(ts.speaker, '')");
  });
});
