export function buildTranscriptSearchQuery(input: string) {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export type TranscriptFullTextSearchQuery = {
  sql: string;
  params: [string];
};

export function buildPostgresTsQuery(input: string) {
  return (
    input
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ") ?? ""
  );
}

export function buildTranscriptFullTextSearchQuery(
  input: string,
): TranscriptFullTextSearchQuery | null {
  const searchText = buildPostgresTsQuery(input);

  if (!searchText) {
    return null;
  }

  return {
    sql: `
SELECT DISTINCT m.*
FROM meetings m
LEFT JOIN transcript_segments ts ON ts.meeting_id = m.id
WHERE
  to_tsvector('english', coalesce(m.title, '') || ' ' || coalesce(m.meeting_url, ''))
    @@ websearch_to_tsquery('english', $1)
  OR to_tsvector('english', coalesce(ts.text, '') || ' ' || coalesce(ts.speaker, ''))
    @@ websearch_to_tsquery('english', $1)
ORDER BY m.started_at DESC NULLS LAST, m.created_at DESC
`.trim(),
    params: [searchText],
  };
}
