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
      entities: [],
      meetingId: "11111111-1111-4111-8111-111111111111",
      providerJobId: "req_123",
      segments: [
        {
          emotionLabel: "neutral",
          emotionReason: "No strong signal",
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
      entities: [],
      segments: [
        {
          emotionLabel: "neutral",
          emotionReason: "No strong signal",
          speaker: "Speaker 1",
          startMs: 1000,
          endMs: 2000,
          text: "Hello there.",
        },
        {
          emotionLabel: "neutral",
          emotionReason: "No strong signal",
          speaker: "Speaker 2",
          startMs: 3000,
          endMs: 3400,
          text: "Yes.",
        },
      ],
    });
  });

  it("maps ElevenLabs speakers to Recall participants by timestamp", () => {
    expect(
      buildElevenLabsTranscriptPersistence(
        {
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
              start: 30,
              end: 30.4,
              speakerId: "speaker_1",
            },
          ],
          metadata: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
        {
          participantTimeline: [
            {
              participantId: "participant_1",
              name: "Alice Chen",
              email: "alice@iosg.vc",
              startMs: 900,
              endMs: 2500,
            },
            {
              participantId: "participant_2",
              name: "Nascent Room",
              email: null,
              startMs: 29000,
              endMs: 32000,
            },
          ],
        },
      ),
    ).toMatchObject({
      action: "complete",
      segments: [
        {
          speaker: "Alice Chen",
          startMs: 1000,
          endMs: 2000,
        },
        {
          speaker: "Nascent Room · Speaker 2",
          startMs: 30000,
          endMs: 30400,
        },
      ],
    });
  });

  it("uses the participant email local name when Recall name is email shaped", () => {
    expect(
      buildElevenLabsTranscriptPersistence(
        {
          eventType: "speech_to_text_transcription",
          type: "speech_to_text_transcription",
          requestId: "req_123",
          transcriptId: null,
          status: "completed",
          transcriptionText: "Hello there.",
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
          ],
          metadata: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
        {
          participantTimeline: [
            {
              participantId: "participant_jocy",
              name: "Jocy@IOSGVC",
              email: "jocy@iosg.vc",
              startMs: 900,
              endMs: 2500,
            },
          ],
        },
      ),
    ).toMatchObject({
      action: "complete",
      segments: [
        {
          speaker: "Jocy",
          startMs: 1000,
          endMs: 2000,
        },
      ],
    });
  });

  it("extracts meeting entities and segment emotion during persistence planning", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: "Nascent asked about Solana deadline risk.",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).toMatchObject({
      action: "complete",
      entities: [
        {
          type: "organization",
          value: "Nascent",
          normalizedValue: "nascent",
        },
        {
          type: "product",
          value: "Solana",
          normalizedValue: "solana",
        },
      ],
      segments: [
        {
          emotionLabel: "hard",
          emotionReason: "High pressure words or fast pace",
          text: "Nascent asked about Solana deadline risk.",
        },
      ],
    });
  });

  it("uses ElevenLabs entities and calendar context for richer entity records", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: "Nascent asked about the follow up.",
        transcriptionEntities: [
          {
            end: null,
            source: "elevenlabs",
            start: null,
            type: "organization",
            value: "Nascent.xyz",
          },
        ],
        metadata: {
          attendeeEmails: "alice@iosg.vc, founder@nascent.xyz",
          meetingId: "11111111-1111-4111-8111-111111111111",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
          workspaceDomain: "iosg.vc",
        },
      }),
    ).toMatchObject({
      action: "complete",
      entities: [
        {
          aliases: ["Nascent.xyz"],
          source: "elevenlabs",
          type: "organization",
          value: "Nascent",
          normalizedValue: "nascent",
        },
        {
          source: "meeting_url",
          type: "meeting_link",
          value: "meet.google.com",
          normalizedValue: "meet.google.com/abc-defg-hij",
        },
      ],
    });
  });

  it("keeps organization name and money entities from ElevenLabs all detection", () => {
    expect(
      buildElevenLabsTranscriptPersistence({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: "Darko mentioned Babylon and 20 million by Wednesday.",
        transcriptionEntities: [
          {
            end: 5,
            source: "elevenlabs",
            start: 0,
            type: "name",
            value: "Darko",
          },
          {
            end: 24,
            source: "elevenlabs",
            start: 16,
            type: "organization",
            value: "Babylon",
          },
          {
            end: 39,
            source: "elevenlabs",
            start: 29,
            type: "money",
            value: "20 million",
          },
          {
            end: 52,
            source: "elevenlabs",
            start: 43,
            type: "date",
            value: "Wednesday",
          },
        ],
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).toMatchObject({
      action: "complete",
      entities: [
        {
          source: "elevenlabs",
          type: "name",
          value: "Darko",
          normalizedValue: "darko",
        },
        {
          source: "elevenlabs",
          type: "organization",
          value: "Babylon",
          normalizedValue: "babylon",
        },
        {
          source: "elevenlabs",
          type: "money",
          value: "20 million",
          normalizedValue: "20 million",
        },
      ],
    });
  });

  it("uses persisted meeting context when ElevenLabs metadata only has ids", () => {
    expect(
      buildElevenLabsTranscriptPersistence(
        {
          eventType: "speech_to_text_transcription",
          type: "speech_to_text_transcription",
          requestId: "req_123",
          transcriptId: null,
          status: "completed",
          transcriptionText: "Nascent asked about the follow up.",
          transcriptionEntities: [
            {
              end: null,
              source: "elevenlabs",
              start: null,
              type: "organization",
              value: "Nascent.xyz",
            },
          ],
          metadata: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
        {
          entityContext: {
            attendeeEmails: ["alice@iosg.vc", "founder@nascent.xyz"],
            meetingUrl: "https://meet.google.com/abc-defg-hij",
            workspaceDomain: "iosg.vc",
          },
        },
      ),
    ).toMatchObject({
      action: "complete",
      entities: [
        {
          aliases: ["Nascent.xyz"],
          source: "elevenlabs",
          type: "organization",
          value: "Nascent",
          normalizedValue: "nascent",
        },
        {
          source: "meeting_url",
          type: "meeting_link",
          value: "meet.google.com",
          normalizedValue: "meet.google.com/abc-defg-hij",
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
