import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  activeTranscriptJobIdsSubquery,
  currentTranscriptJobIdsSubquery,
} from "@/lib/current-transcript-job";

const dialect = new PgDialect();

describe("currentTranscriptJobIdsSubquery", () => {
  it("selects completed jobs from the latest replacement generation", () => {
    const query = dialect.sqlToQuery(
      currentTranscriptJobIdsSubquery("11111111-1111-4111-8111-111111111111"),
    );

    expect(query.sql).toContain("mode = 'replace'");
    expect(query.sql).toContain("current_jobs.mode = 'append'");
    expect(query.sql).toContain("current_jobs.generation_id");
    expect(query.sql).toContain("current_jobs.created_at >");
    expect(query.sql).toContain("current_jobs.status = 'completed'");
  });

  it("includes pending and failed jobs in the active generation", () => {
    const query = dialect.sqlToQuery(
      activeTranscriptJobIdsSubquery("11111111-1111-4111-8111-111111111111"),
    );

    expect(query.sql).toContain("mode = 'replace'");
    expect(query.sql).not.toContain("status = 'completed'");
  });
});
