import { describe, expect, it, vi } from "vitest";

import { buildElevenLabsTranscriptPersistence } from "@/lib/elevenlabs-transcripts";

vi.mock("@/db/client", () => ({
  db: {},
}));

describe("buildElevenLabsTranscriptPersistence", () => {
  it("builds a completion update from transcript metadata and text", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: " Transcript text ",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).toEqual({
      action: "complete",
      meetingId: "11111111-1111-4111-8111-111111111111",
      providerJobId: "req_123",
      segments: [
        {
          speaker: null,
          startMs: 0,
          endMs: null,
          text: "Transcript text",
        },
      ],
      text: "Transcript text",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("builds speaker separated segments from ElevenLabs words", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: "Hello there. Yes.",
        transcriptionWords: [
          {
            text: "Hello",
            type: "word",
            start: 1,
            end: 1.4,
            speakerId: "speaker_0",
          },
          {
            text: " there.",
            type: "word",
            start: 1.4,
            end: 2,
            speakerId: "speaker_0",
          },
          {
            text: "Yes.",
            type: "word",
            start: 3,
            end: 3.4,
            speakerId: "speaker_1",
          },
        ],
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).toMatchObject({
      action: "complete",
      segments: [
        {
          speaker: "Speaker 1",
          startMs: 1000,
          endMs: 2000,
          text: "Hello there.",
        },
        {
          speaker: "Speaker 2",
          startMs: 3000,
          endMs: 3400,
          text: "Yes.",
        },
      ],
    });
  });

  it("builds a failure update when ElevenLabs reports a failed status", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "failed",
        transcriptionText: null,
        metadata: {
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).toEqual({
      action: "fail",
      providerJobId: "req_123",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("skips payloads that cannot be mapped to a local transcript job", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: "Transcript text",
        metadata: {},
      }),
    ).toEqual({
      action: "skip",
      reason: "missing_transcript_job_id",
    });
  });
});
