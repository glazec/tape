const HAN_CHARACTER_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const LATIN_WORD_PATTERN = /[A-Za-z][A-Za-z']*/g;
const MIN_CHINESE_CHARACTERS = 12;
const CHINESE_SCORE_THRESHOLD = 0.35;

export function shouldAutoTranslateTranscript(text: string) {
  return !isMostlyChineseTranscript(text);
}

function isMostlyChineseTranscript(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return false;
  }

  const chineseCharacterCount = Array.from(trimmedText).filter((character) =>
    HAN_CHARACTER_PATTERN.test(character),
  ).length;

  if (chineseCharacterCount < MIN_CHINESE_CHARACTERS) {
    return false;
  }

  const latinWordCount = trimmedText.match(LATIN_WORD_PATTERN)?.length ?? 0;
  const chineseScore =
    chineseCharacterCount / (chineseCharacterCount + latinWordCount * 2);

  return chineseScore >= CHINESE_SCORE_THRESHOLD;
}
