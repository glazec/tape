import { shouldAutoTranslateTranscript, type TranslationLanguage } from "@/lib/meeting-translation-language";
import type { MeetingTranscript } from "@/lib/meeting-queries";

export function applyPreferredTranscriptLanguage(meeting: MeetingTranscript, language: TranslationLanguage) {
  const storedLanguage = meeting.translationLanguage;
  meeting.segments = meeting.segments.map(segment => ({ ...segment,
    translatedText: segment.translationCopies?.[language] ?? (storedLanguage === language ? segment.translatedText : null),
  }));
  const translated = meeting.segments.filter(segment => segment.translatedText?.trim()).length;
  const needsTranslation = shouldAutoTranslateTranscript(meeting.segments.map(segment => segment.text).join("\n"), language);
  const active = storedLanguage === language && ["queued", "running", "failed"].includes(meeting.translationSummary.status);
  meeting.translationLanguage = language;
  meeting.translationSummary = {
    ...meeting.translationSummary,
    hasTranslations: translated > 0,
    translatedSegments: translated,
    status: translated === meeting.segments.length && translated > 0 ? "completed"
      : !needsTranslation ? "not_needed"
      : active ? meeting.translationSummary.status : translated ? "partial" : "not_started",
  };
}
