import { expect, it, vi } from "vitest";
import type { MeetingFollowup } from "@/lib/meeting-followup";
const mocks = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/vendors/openrouter", () => ({ translateTranscriptSegments: mocks.translate }));
vi.mock("@/lib/meeting-composition", () => ({ getComposedMeetingForFollowup: vi.fn() }));
import { translateFollowupCopy } from "@/lib/meeting-followup-translation";
import { collectRecentCompanyHints } from "@/lib/recent-meeting-companies";
const source: MeetingFollowup = { todos: [], dynamics: [{ person: "Jane", text: "Jane offers an introduction.", evidence: [{ segmentId: "segment", quote: "I can introduce you." }] }], research: [], connections: [{ kind: "organization", name: "Acme", title: null, company: null, mutual: false, relationship: "met", context: "Met at the event.", speakerSegmentId: "segment", evidence: [{ segmentId: "segment" }] }] };
it("translates only display text and keeps the same shared facts and original quotes", async () => {
  mocks.translate.mockResolvedValue([{ id: "1", text: "曾在活动中会面。" }, { id: "0", text: "提出可以引荐。" }]);
  const result = await translateFollowupCopy(source, "zh-CN", "meeting");
  expect(result.dynamics).toEqual([{ ...source.dynamics[0], text: "Jane 提出可以引荐。" }]);
  expect(result.connections).toEqual([{ ...source.connections![0], context: "曾在活动中会面。" }]);
  expect(source.dynamics[0].text).toBe("Jane offers an introduction.");
  mocks.translate.mockResolvedValue([{ id: "0", text: "提出可以引荐。" }]);
  await expect(translateFollowupCopy(source, "zh-CN", "meeting")).rejects.toThrow("Incomplete");
});
it("bounds company hints, removes repeated entries and excludes personal addresses", () => {
  const events = [{ title: "Acme x Aperture", attendeeEmails: ["jane@acme.com", "name@gmail.com"] },
    { title: "Weekly sync", attendeeEmails: ["other@acme.com"] }, ...Array.from({ length: 110 }, (_, i) => ({ title: `Company ${i}`, attendeeEmails: [] }))];
  const names = collectRecentCompanyHints(events);
  expect(names).toHaveLength(100);
  expect(new Set(names).size).toBe(100);
  expect(names).toContain("Aperture");
  expect(names.join(" ")).not.toMatch(/@|gmail|Weekly sync|Company 109/);
});

it("chooses each reader's saved transcript copy without altering the original segments", async () => {
  const { applyPreferredTranscriptLanguage } = await import("@/lib/preferred-transcript-language");
  const fixture = { translationLanguage: "en", translationSummary: { status: "completed", translatedSegments: 1, totalSegments: 1 },
    segments: [{ text: "原文", translatedText: "Original text", translationCopies: { "zh-CN": "校对后的原文", en: "Original text" } }] };
  const english = structuredClone(fixture), chinese = structuredClone(fixture);
  type Transcript = Parameters<typeof applyPreferredTranscriptLanguage>[0];
  applyPreferredTranscriptLanguage(english as Transcript, "en");
  applyPreferredTranscriptLanguage(chinese as Transcript, "zh-CN");
  expect(english.segments[0].translatedText).toBe("Original text");
  expect(chinese.segments[0].translatedText).toBe("校对后的原文");
  expect(chinese.segments[0].text).toBe(english.segments[0].text);
});


it("resolves cached translation subjects after a preferred name edit using the same evidence", async () => {
  const { getComposedMeetingForFollowup } = await import("@/lib/meeting-composition");
  const { getFollowupSourceHash } = await import("@/lib/meeting-followup-source");
  const { getOrTranslateFollowupCopy } = await import("@/lib/meeting-followup-translation");
  const transcript = { title: "Call", startedAt: null, segments: [{ id: "segment", speaker: "Alex", sourceSpeaker: "Jane", personId: "p1", meetingSpeakerId: "g1", startMs: 0, text: "I can introduce you." }] };
  const result = { ...source, connections: [] };
  const translated = { ...result, dynamics: [{ ...result.dynamics[0], text: "Jane 提出可以引荐。" }] };
  const sourceHash = getFollowupSourceHash(transcript);
  vi.mocked(getComposedMeetingForFollowup).mockResolvedValue({ ...transcript, status: "ready", transcriptJobStatus: "completed",
    aiFollowup: { sourceHash, speakerNames: { segment: "Jane" }, result, translations: { "zh-CN": translated } },
  } as unknown as NonNullable<Awaited<ReturnType<typeof getComposedMeetingForFollowup>>>);
  const copy = await getOrTranslateFollowupCopy({ teamId: "team", userId: "user", domain: "test" }, "meeting", "zh-CN", sourceHash);
  expect(copy && copy !== "in_progress" && copy.dynamics[0]).toMatchObject({ person: "Alex", text: "Alex 提出可以引荐。" });
  expect(translated.dynamics[0].person).toBe("Jane");
});
