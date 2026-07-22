import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  applySpeakerUpdateToSegments,
  getSpeakerPreviewClips,
  getSpeakerPreviewTransition,
  getSpeakerRenameSuggestions,
  getVisualAssetPlacements,
  getWaveformHoverSnapshot,
  MeetingVisualLightbox,
  shouldDecodeAudioWaveform,
  TranscriptViewer,
  type EditingSpeaker,
  type TranscriptSegment,
} from "@/components/transcript-viewer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const segments = [
  {
    id: "segment_123",
    speaker: "Speaker 1",
    startMs: 0,
    endMs: 1000,
    text: "Hello team",
  },
];
const pacedText = Array.from({ length: 60 }, (_, index) => `word${index}`).join(
  " ",
);

function makeSegment(id: string, speaker: string): TranscriptSegment {
  return {
    id,
    speaker,
    startMs: 0,
    endMs: 1000,
    text: "Hello",
  };
}

describe("TranscriptViewer", () => {
  it("hides speaker editing when no meeting id is provided", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html).toContain("Speaker 1");
    expect(html).not.toContain("Edit speaker");
  });

  it("places the timestamp after the speaker before the sentence", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html.indexOf("Speaker 1")).toBeLessThan(html.indexOf("0:00"));
    expect(html.indexOf("0:00")).toBeLessThan(html.indexOf("Hello"));
  });

  it("collapses duplicate transcript rows with the same speaker, time, and text", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          segments[0],
          {
            ...segments[0],
            id: "segment_456",
          },
          {
            ...segments[0],
            id: "segment_789",
            translatedText: "大家好",
          },
          {
            ...segments[0],
            emotionLabel: "neutral",
            id: "segment_999",
            startMs: 450,
            speaker: " Speaker 1 ",
            text: "Different source line",
            translatedText: "大家好",
          },
        ]}
      />,
    );

    expect(html.match(/Hello team/g)).toHaveLength(1);
    expect(html).not.toContain("Different source line");
    expect(html).toContain("大家");
    expect(html).toContain("好");
  });

  it("renders transcript rows without divider classes", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html).not.toMatch(/<li[^>]*border-t/);
    expect(html).not.toMatch(/<li[^>]*border-b/);
  });

  it("makes transcript words seekable when audio is available", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer audioUrl="/audio.mp3" segments={segments} />,
    );

    expect(html).toContain('aria-label="Play transcript from 0:00"');
    expect(html).toContain('data-transcript-word-index="0"');
    expect(html).toContain('data-transcript-word-index="1"');
  });

  it("does not pad every clickable transcript word", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer audioUrl="/audio.mp3" segments={segments} />,
    );

    expect(html).toContain('data-transcript-word-index="0"');
    expect(html).not.toContain("px-0.5");
  });

  it("keeps dotted product names in one deterministic transcript token", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        segments={[
          {
            ...segments[0],
            text: "Ether.fi is mentioned",
          },
        ]}
      />,
    );

    expect(html).toContain(">Ether.fi<");
    expect(html).toContain('data-transcript-word-index="0"');
    expect(html).toContain('data-transcript-word-index="1"');
    expect(html).toContain('data-transcript-word-index="2"');
  });

  it("keeps transcript words read only when audio is unavailable", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html).not.toContain("Play transcript from 0:00");
    expect(html).not.toContain("hover:bg-primary/15");
  });

  it("shows speaker editing for workspace meeting pages", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={segments}
      />,
    );

    expect(html).toContain("Edit speaker");
  });

  it("labels speaker summary chips as rename controls", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={segments}
      />,
    );

    expect(html).toContain('aria-label="Rename Speaker 1 everywhere"');
  });

  it("uses different label colors for different speakers", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          {
            id: "segment_yiping",
            speaker: "YiPing Lu",
            startMs: 0,
            endMs: 1000,
            text: "Hello",
          },
          {
            id: "segment_gregory",
            speaker: "Gregory Rocco",
            startMs: 1000,
            endMs: 2000,
            text: "Hi",
          },
        ]}
      />,
    );
    const labelColors = Array.from(
      html.matchAll(/background-color:(#[0-9a-f]{6})/g),
      (match) => match[1],
    );

    expect(new Set(labelColors)).toHaveLength(2);
  });

  it("merges obvious speaker aliases in the speaker list and transcript rows", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={[
          {
            id: "segment_test",
            speaker: "Test User",
            startMs: 0,
            endMs: 1000,
            text: "Hello",
          },
          {
            id: "segment_test_alias",
            speaker: "TeSt User",
            startMs: 1000,
            endMs: 2000,
            text: "Hi",
          },
          {
            id: "segment_siddharth",
            speaker: "Siddharth Singh",
            startMs: 2000,
            endMs: 3000,
            text: "Good morning",
          },
          {
            id: "segment_siddharth_handle",
            speaker: "Siddharth77work",
            startMs: 3000,
            endMs: 3001,
            text: "Yes",
          },
        ]}
      />,
    );

    expect(html).toContain("Test User");
    expect(html).not.toContain("TeSt User");
    expect(html).toContain("Siddharth Singh");
    expect(html).not.toContain("Siddharth77work");
  });

  it("merges email shaped speaker labels with their local name", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={[
          {
            id: "segment_member_email",
            speaker: "Member@IOSGVC",
            startMs: 0,
            endMs: 1000,
            text: "Hello",
          },
          {
            id: "segment_member_name",
            speaker: "Member",
            startMs: 1000,
            endMs: 2000,
            text: "Hi",
          },
        ]}
      />,
    );

    expect(html).toContain("Member");
    expect(html).not.toContain("Member@IOSGVC");
  });

  it("merges a unique first name speaker alias into the full name", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={[
          {
            id: "segment_guest_full",
            speaker: "Guest User",
            startMs: 0,
            endMs: 1000,
            text: "Hello",
          },
          {
            id: "segment_guest_first",
            speaker: "Guest",
            startMs: 1000,
            endMs: 2000,
            text: "Hi",
          },
        ]}
      />,
    );

    expect(html).toContain("Guest User");
    expect(html).not.toContain(">Guest<");
  });

  it("merges saved team speaker aliases into their canonical speaker", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        meetingId="11111111-1111-4111-8111-111111111111"
        speakerAliases={[
          { alias: "Saved Alias", canonicalName: "Test User" },
          { alias: "Ether C", canonicalName: "Ethan Chen" },
        ]}
        segments={[
          {
            id: "segment_test",
            speaker: "Test User",
            startMs: 0,
            endMs: 1000,
            text: "Hello",
          },
          {
            id: "segment_yi_alias",
            speaker: "Saved Alias",
            startMs: 1000,
            endMs: 2000,
            text: "Hi",
          },
          {
            id: "segment_ethan_alias",
            speaker: "Ether C",
            startMs: 2000,
            endMs: 3000,
            text: "Yes",
          },
        ]}
      />,
    );

    expect(html).toContain("Test User");
    expect(html).toContain("Ethan Chen");
    expect(html).not.toContain("Saved Alias");
    expect(html).not.toContain("Ether C");
  });

  it("does not merge a first name when multiple full names share it", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={[
          {
            id: "segment_alex_chen",
            speaker: "Alex Chen",
            startMs: 0,
            endMs: 1000,
            text: "Hello",
          },
          {
            id: "segment_alex_wang",
            speaker: "Alex Wang",
            startMs: 1000,
            endMs: 2000,
            text: "Hi",
          },
          {
            id: "segment_alex_first",
            speaker: "Alex",
            startMs: 2000,
            endMs: 3000,
            text: "Yes",
          },
        ]}
      />,
    );

    expect(html).toContain("Alex Chen");
    expect(html).toContain("Alex Wang");
    expect(html).toContain(">Alex<");
  });

  it("offers speaker voice previews when meeting audio is available", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/audio.mp3"
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={segments}
      />,
    );

    expect(html).toContain('aria-label="Preview Speaker 1"');
  });

  it("keeps every participant available in the speaker rename suggestions", () => {
    const suggestions = Array.from({ length: 12 }, (_, index) => ({
      email: `participant-${index + 1}@example.com`,
      name: `Participant ${index + 1}`,
    }));

    expect(getSpeakerRenameSuggestions(suggestions).map((item) => item.name)).toEqual(
      suggestions.map((item) => item.name),
    );
  });

  it("skips full audio waveform decoding for long recordings", () => {
    expect(
      shouldDecodeAudioWaveform({
        duration: 60 * 60 * 2,
        timelineDuration: 60 * 60 * 2,
      }),
    ).toBe(false);
    expect(
      shouldDecodeAudioWaveform({
        duration: 60 * 20,
        timelineDuration: 60 * 20,
      }),
    ).toBe(true);
    expect(
      shouldDecodeAudioWaveform({
        duration: 0,
        timelineDuration: 0,
      }),
    ).toBe(true);
  });

  it("builds speaker preview clips that skip over other speakers", () => {
    const previewSegments: TranscriptSegment[] = [
      {
        id: "segment_alice_1",
        speaker: "Alice",
        startMs: 0,
        endMs: null,
        text: "Alice first",
      },
      {
        id: "segment_bob",
        speaker: "Bob",
        startMs: 900,
        endMs: 2000,
        text: "Bob talks",
      },
      {
        id: "segment_alice_2",
        speaker: "Alice",
        startMs: 2000,
        endMs: 2600,
        text: "Alice again",
      },
    ];
    const clips = getSpeakerPreviewClips(previewSegments, "Alice", []);

    expect(clips).toEqual([
      { startMs: 0, endMs: 900 },
      { startMs: 2000, endMs: 2600 },
    ]);
    expect(getSpeakerPreviewTransition(clips, 0, 899)).toEqual({
      type: "continue",
    });
    expect(getSpeakerPreviewTransition(clips, 0, 900)).toEqual({
      clip: { startMs: 2000, endMs: 2600 },
      index: 1,
      type: "jump",
    });
    expect(getSpeakerPreviewTransition(clips, 1, 2600)).toEqual({
      type: "done",
    });
  });

  it("merges speaker aliases when applying to the same speaker", () => {
    const editingSpeaker: EditingSpeaker = {
      allowSegmentScope: false,
      currentSpeaker: "Speaker 2",
      segmentId: "segment_alias",
      speakerAliases: ["TeSt User"],
      speakerKey: "Speaker 2",
    };

    expect(
      applySpeakerUpdateToSegments(
        [
          makeSegment("segment_alias", "Speaker 2"),
          makeSegment("segment_case", "TeSt User"),
          makeSegment("segment_existing", "Test User"),
          makeSegment("segment_other", "Siddharth Singh"),
        ],
        editingSpeaker,
        "matching_speaker",
        "Test User",
      ).map((segment) => [segment.id, segment.speaker]),
    ).toEqual([
      ["segment_alias", "Test User"],
      ["segment_case", "Test User"],
      ["segment_existing", "Test User"],
      ["segment_other", "Siddharth Singh"],
    ]);
  });

  it("keeps line scoped speaker corrections limited to one segment", () => {
    const editingSpeaker: EditingSpeaker = {
      allowSegmentScope: true,
      currentSpeaker: "Speaker 2",
      segmentId: "segment_alias",
      speakerAliases: ["TeSt User"],
      speakerKey: "Speaker 2",
    };

    expect(
      applySpeakerUpdateToSegments(
        [
          makeSegment("segment_alias", "Speaker 2"),
          makeSegment("segment_case", "TeSt User"),
          makeSegment("segment_existing", "Test User"),
        ],
        editingSpeaker,
        "segment",
        "Test User",
      ).map((segment) => [segment.id, segment.speaker]),
    ).toEqual([
      ["segment_alias", "Test User"],
      ["segment_case", "TeSt User"],
      ["segment_existing", "Test User"],
    ]);
  });

  it("shows polished original text first with raw text on hover", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          {
            ...segments[0],
            polishedText: "Hello, team.",
            translatedText: "大家好",
          },
        ]}
      />,
    );

    expect(html).toContain("Polished");
    expect(html).toContain("Original language");
    expect(html).toContain('aria-label="Transcript language"');
    expect(html).toContain('aria-label="Transcript style"');
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Show original language transcript");
    expect(html).not.toContain("Show polished transcript");
    expect(html).toContain("Hello,");
    expect(html).toContain("team.");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("group-hover/original:opacity-100");
    expect(html).toContain("Hello team");
    expect(html).not.toContain("大家好");
    expect(html).not.toContain("Original sentence");
  });

  it("shows polished Chinese source text without a translation language switch", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          {
            id: "segment_zh",
            speaker: "Speaker 1",
            startMs: 0,
            endMs: 1000,
            text: "然后我们先看一下 pipeline。",
            polishedText: "我们先看 pipeline。",
          },
        ]}
      />,
    );

    expect(html).toContain("Polished");
    expect(html).toContain('aria-label="Transcript style"');
    expect(html).toContain("我们先看");
    expect(html).toContain("pipeline。");
    expect(html).toContain("然后我们先看一下 pipeline。");
    expect(html).not.toContain("Chinese");
  });

  it("shows translation progress when Chinese text is still being prepared", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={segments}
        translationSummary={{
          hasTranslations: false,
          status: "running",
          totalSegments: 672,
          translatedSegments: 0,
        }}
      />,
    );

    expect(html).toContain("Translation in progress");
    expect(html).toContain("0 of 672 lines translated");
  });

  it("shows when a transcript does not need translation", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={segments}
        translationSummary={{
          hasTranslations: false,
          status: "not_needed",
          totalSegments: 672,
          translatedSegments: 0,
        }}
      />,
    );

    expect(html).toContain("Translation not needed");
    expect(html).toContain("This transcript already appears to be Chinese.");
    expect(html).toContain("Translate anyway");
  });

  it("hides translation correction controls on workspace meetings", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={[
          {
            ...segments[0],
            translatedText: "大家好",
          },
        ]}
      />,
    );

    expect(html).not.toContain("Edit translation");
  });

  it("shows emotion labels without exposing model details", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          {
            ...segments[0],
            emotionLabel: "hard",
            emotionReason: "High pressure words or fast pace",
          },
        ]}
      />,
    );

    expect(html).toContain("Hard");
    expect(html).not.toContain("High pressure words or fast pace");
  });

  it("shows captured meeting images inline at their transcript position", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={segments}
        visualAssets={[
          {
            id: "image_123",
            capturedAt: "2026-06-29T14:01:05.000Z",
            timestampMs: 65000,
            url: "/api/meetings/11111111-1111-4111-8111-111111111111/images/image_123",
          },
        ]}
      />,
    );

    expect(html).toContain("Meeting images");
    expect(html).toContain('aria-label="Browse all captured images"');
    expect(html).toContain("Open image from 1:05");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('id="segment_123"');
    expect(html.indexOf('id="segment_123"')).toBeLessThan(
      html.lastIndexOf("Open image from 1:05"),
    );
  });

  it("shows the target image number and loading state while it downloads", () => {
    const html = renderToStaticMarkup(
      <MeetingVisualLightbox
        assetIndex={1}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onShowInTranscript={vi.fn()}
        visualAssets={[
          {
            id: "image_123",
            capturedAt: null,
            timestampMs: 0,
            url: "/images/image_123",
          },
          {
            id: "image_456",
            capturedAt: null,
            timestampMs: 1000,
            url: "/images/image_456",
          },
        ]}
      />,
    );

    expect(html).toContain("2 of 2");
    expect(html).toContain("Loading image 2 of 2");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('src="/images/image_456"');
  });

  it("places visual assets on the segment speaking when they were captured", () => {
    const timelineSegments: TranscriptSegment[] = [
      { id: "seg_a", speaker: "A", startMs: 0, endMs: 30000, text: "Intro" },
      { id: "seg_b", speaker: "B", startMs: 30000, endMs: 60000, text: "Demo" },
      { id: "seg_c", speaker: "A", startMs: 60000, endMs: null, text: "Wrap" },
    ];
    const placements = getVisualAssetPlacements(timelineSegments, [
      { id: "img_0", capturedAt: null, timestampMs: 45000, url: "/img_0" },
      { id: "img_1", capturedAt: null, timestampMs: 59000, url: "/img_1" },
      { id: "img_2", capturedAt: null, timestampMs: 60000, url: "/img_2" },
      { id: "img_3", capturedAt: "2026-06-29T14:01:05.000Z", timestampMs: null, url: "/img_3" },
    ]);

    expect(placements.bySegmentId.get("seg_b")).toEqual([0, 1]);
    expect(placements.bySegmentId.get("seg_c")).toEqual([2]);
    expect(placements.bySegmentId.has("seg_a")).toBe(false);
    expect(placements.leading).toEqual([]);
  });

  it("keeps assets captured before the first segment ahead of the transcript", () => {
    const timelineSegments: TranscriptSegment[] = [
      { id: "seg_a", speaker: "A", startMs: 10000, endMs: null, text: "Late start" },
    ];
    const placements = getVisualAssetPlacements(timelineSegments, [
      { id: "img_0", capturedAt: null, timestampMs: 2000, url: "/img_0" },
    ]);

    expect(placements.leading).toEqual([0]);
    expect(placements.bySegmentId.size).toBe(0);
  });

  it("renders the transcript waveform immediately with subtle loading motion", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            endMs: 30000,
            emotionLabel: "hard",
            text: pacedText,
          },
        ]}
      />,
    );

    expect(html).toContain("Speaker 1 · Hard");
    expect(html).toContain("120 wpm");
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Loading waveform");
    expect(html).not.toContain("Audio waveform loading");
    expect(html).toContain("Current section: Speaker 1 · Hard, 120 wpm");
    expect(html).not.toContain("animate-spin");
    expect(html).toContain(
      'aria-label="Audio waveform, Speaker 1 · Hard, 120 wpm"',
    );
    expect(html).toContain("<svg");
    expect(html).toContain("Words per minute trend");
    expect(html).not.toContain("<polygon");
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(html).toContain("<polyline");
    expect(html).toContain("group-hover/rail:opacity-100");
    expect(html).toContain("top-0 z-40 h-6");
    expect(html).toContain("bottom-0 z-40 h-6");
    expect(html).toContain("group-hover/wpm:opacity-100");
    expect(html).toContain("WPM trend: 120 wpm");
    expect(html).toContain("Speaker: Speaker 1");
    expect(html).toContain("Emotion: Hard");
    expect(html).toContain("WPM: 120 wpm");
    expect(
      (html.match(/background-color:#2563eb/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(html).toContain('title="Speaker 1"');
    expect(html).toContain('title="Hard emotion"');
    expect(html).toContain('stroke="#f97316"');
  });

  it("shows 5 second backward and forward controls on the audio player", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer audioUrl="/audio.mp3" segments={segments} />,
    );

    expect(html).toContain('aria-label="Skip back 5 seconds"');
    expect(html).toContain('aria-label="Skip forward 5 seconds"');
    expect((html.match(/5s/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("col-span-2");
  });

  it("calculates the WPM tooltip from the hovered waveform position", () => {
    const lowPace = getWaveformHoverSnapshot({
      boundsLeft: 0,
      boundsWidth: 100,
      clientX: 25,
      samples: [
        { endSecond: 120, startSecond: 0, wordCount: 120 },
        { endSecond: 240, startSecond: 120, wordCount: 480 },
      ],
      timelineDuration: 240,
    });
    const highPace = getWaveformHoverSnapshot({
      boundsLeft: 0,
      boundsWidth: 100,
      clientX: 75,
      samples: [
        { endSecond: 120, startSecond: 0, wordCount: 120 },
        { endSecond: 240, startSecond: 120, wordCount: 480 },
      ],
      timelineDuration: 240,
    });

    expect(lowPace).toEqual({
      leftPercent: 25,
      timeSecond: 60,
      wpmLabel: "60 wpm",
    });
    expect(highPace).toEqual({
      leftPercent: 75,
      timeSecond: 180,
      wpmLabel: "240 wpm",
    });
  });

  it("keeps neutral waveform labels to the speaker name without a colored emotion", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            endMs: 30000,
            emotionLabel: "neutral",
            text: pacedText,
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Audio waveform, Speaker 1, 120 wpm"');
    expect(html).not.toContain("Speaker 1 · Neutral");
    expect(html).not.toContain('title="Neutral emotion"');
    expect(html).not.toContain("background-color:#94a3b8");
    expect(html).toContain("No emotion signal");
  });

  it("limits waveform emotion colors to hard and chill", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            emotionLabel: "hard",
            id: "segment_hard",
            startMs: 0,
            endMs: 10000,
            text: pacedText,
          },
          {
            ...segments[0],
            emotionLabel: "chill",
            id: "segment_chill",
            startMs: 10000,
            endMs: 20000,
            text: pacedText,
          },
          {
            ...segments[0],
            emotionLabel: "neutral",
            id: "segment_neutral",
            startMs: 20000,
            endMs: 30000,
            text: pacedText,
          },
        ]}
      />,
    );

    expect(html).toContain("background-color:#dc2626");
    expect(html).toContain("background-color:#059669");
    expect(html).not.toContain("background-color:#94a3b8");
  });

  it("uses multilingual words for smoothed waveform pace", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            endMs: 30000,
            text: "听得到吗我们开始讨论会议记录和后续事项".repeat(6),
          },
        ]}
      />,
    );

    expect(html).toMatch(/Audio waveform, Speaker 1, (?!0 wpm)\d+ wpm/);
    expect(html).toContain('stroke="#f97316"');
  });
});
