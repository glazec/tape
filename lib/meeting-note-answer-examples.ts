// Evaluated examples for grounded note answers.
export const NOTE_ANSWER_EXAMPLES = `
Use this evidence-first procedure:
1. Split the question into the requested facts. For each fact, determine whether the transcript supplies a value, explicitly says it is unknown, or does not discuss it. Every requested fact whose answer is unavailable must appear as a short topic in missing. Saying "unknown" in items does not replace a missing entry. Preserve any known constraints or unresolved definition separately in a grounded item.
2. Select quotations before writing answer items. Copy exact contiguous substrings, character for character, from a single segment. Prefer that segment's full sentence or full text when it is short. Never rewrite, translate, add a pronoun, or combine separated fragments inside quote. Every qualifier in the answer (time, unit, definition, condition, correction) must be supported by the chosen quotations, not merely by text elsewhere in the segment.
3. Write each answer in the question's language. Preserve the final corrected value, distinguish a metric from a different requested metric, and distinguish the date associated with a request from the date it was canceled. Do not introduce a causal link merely because two facts appear together.
4. Audit all requested facts against items and missing, then check each quote with exact substring matching mentally. Return only the original JSON schema.

The examples below teach the procedure, not facts to copy into the current answer.

Example A:
Question: "What were support costs for March and April?"
Transcript: [{"id":"exA","text":"Support costs were $24,000 in March. I do not have April's figure."}]
Correct output:
{"items":[{"text":"March support costs were $24,000.","sources":[{"segmentId":"exA","quote":"Support costs were $24,000 in March."}]}],"missing":["April support costs"]}
An accurate statement that April is unknown still requires the missing label.

Example B:
Question: "七月底年化收入和七月实际收入是多少？"
Transcript: [{"id":"exB","text":"七月底年化收入是 240 万美元，不，是 250 万美元。这不是七月实际收入，实际收入还没有提供。"}]
Correct output:
{"items":[{"text":"七月底年化收入更正为 250 万美元，不能将它当作七月实际收入。","sources":[{"segmentId":"exB","quote":"七月底年化收入是 240 万美元，不，是 250 万美元。这不是七月实际收入，实际收入还没有提供。"}]}],"missing":["七月实际收入"]}
Quoting only "250 万美元" would not support the time window and metric definition. Copying the full source avoids fabricating a new quotation.

Example C:
Source: "The request from February has been canceled. The cancellation date was not stated."
Supported: "The February request is no longer active."
Unsupported: "The request was canceled in February."
If asked when it was canceled, add "Cancellation date" to missing. Do not change which event the date modifies.
`;
