// A statement substantial enough to stand as evidence of someone's interest or
// need: at least eight Chinese characters or three words. Replies such as "好。",
// "对对" or "Sounds good." are not.
export function isSubstantive(text: string) {
  return (text.match(/[㐀-鿿]/g)?.length ?? 0) >= 8
    || (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0) >= 3;
}

// Meeting recorders and notetaker bots transcribed as speakers are not people.
export function isRecordingBot(name: string) {
  return /note[\s_-]*taker|\bnotes? bot\b|\botter(\.ai)?\b|fireflies|fathom|\bread\.ai\b|\btl;?dv\b|\brecorder\b|\bbot\b|会议助手|记录助手/i.test(name);
}
