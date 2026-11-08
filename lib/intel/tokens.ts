// Jev decision request limits, measured against typesafe/jev-1.14 on 2026-11-08:
// a choice question accepts at most 255 options (HTTP 422), and a request between
// 250k and 350k input tokens fails with max_tokens_exceeded (HTTP 400). Chinese
// text costs about one token per character; English about one per five or more.
export const JEV_MAX_CHOICE_OPTIONS = 255;
export const JEV_SAFE_REQUEST_TOKENS = 200_000;
// Room for typed questions: up to 12 people with four questions each and capped
// evidence options keyed by segment identifiers.
export const JEV_QUESTION_RESERVE_TOKENS = 72_000;
export const JEV_STATE_TOKENS = JEV_SAFE_REQUEST_TOKENS - JEV_QUESTION_RESERVE_TOKENS;

const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

// Conservative estimate: one token per CJK character, one per three other characters.
export function estimateTokens(text: string) {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 3);
}

// Jev refused the request for its size (too many tokens or options). Splitting the
// batch can succeed; repeating the same request cannot.
export class JevRequestTooLargeError extends Error {}
