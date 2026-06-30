import { describe, expect, it } from "vitest";

import {
  buildSmartMeetingTitle,
  buildTeamVocabularyKeyterms,
  buildTranscriptionKeyterms,
  classifySegmentEmotion,
  extractMeetingEntities,
  groupRelatedMeetings,
} from "@/lib/meeting-intelligence";

describe("meeting intelligence helpers", () => {
  it("deduplicates team vocabulary before transcription", () => {
    expect(
      buildTeamVocabularyKeyterms([
        { term: " IOSG " },
        { term: "TCG platform", hint: "trading card game" },
        { term: "iosg" },
        { term: "" },
      ]),
    ).toEqual(["IOSG", "TCG platform"]);
  });

  it("keeps transcription keyterms inside provider limits", () => {
    const oversizedTerm = "a".repeat(51);
    const keyterms = buildTranscriptionKeyterms(
      [" IOSG ", oversizedTerm, "iosg"],
      Array.from({ length: 1005 }, (_, index) => `Project ${index}`),
    );

    expect(keyterms).toHaveLength(1000);
    expect(keyterms[0]).toBe("IOSG");
    expect(keyterms).not.toContain(oversizedTerm);
    expect(keyterms.filter((term) => term.toLowerCase() === "iosg")).toHaveLength(
      1,
    );
  });

  it("uses the event title unless it is a generic online meeting title", () => {
    expect(
      buildSmartMeetingTitle({
        eventTitle: "Zoom Meeting",
        attendeeEmails: ["alice@iosg.vc", "founder@nascent.xyz"],
        workspaceDomain: "iosg.vc",
      }),
    ).toBe("IOSG <> Nascent");

    expect(
      buildSmartMeetingTitle({
        eventTitle: "Nascent founder follow up",
        attendeeEmails: ["alice@iosg.vc", "founder@nascent.xyz"],
        workspaceDomain: "iosg.vc",
      }),
    ).toBe("Nascent founder follow up");
  });

  it("extracts normalized organization and product entities", () => {
    expect(
      extractMeetingEntities([
        {
          id: "segment_1",
          text: "Nascent asked about Solana liquidity and the TCG platform.",
        },
      ]),
    ).toEqual([
      {
        aliases: [],
        segmentId: "segment_1",
        source: "transcript",
        type: "organization",
        value: "Nascent",
        normalizedValue: "nascent",
      },
      {
        aliases: [],
        segmentId: "segment_1",
        source: "transcript",
        type: "product",
        value: "Solana",
        normalizedValue: "solana",
      },
      {
        aliases: [],
        segmentId: "segment_1",
        source: "transcript",
        type: "product",
        value: "TCG",
        normalizedValue: "tcg",
      },
    ]);
  });

  it("does not use the workspace organization as a meeting entity", () => {
    expect(
      extractMeetingEntities(
        [
          {
            id: "segment_1",
            text: "IOSG and Nascent talked through the Solana follow up.",
          },
        ],
        { workspaceDomain: "iosg.vc" },
      ),
    ).toEqual([
      {
        aliases: [],
        segmentId: "segment_1",
        source: "transcript",
        type: "organization",
        value: "Nascent",
        normalizedValue: "nascent",
      },
      {
        aliases: [],
        segmentId: "segment_1",
        source: "transcript",
        type: "product",
        value: "Solana",
        normalizedValue: "solana",
      },
    ]);
  });

  it("adds canonical organization aliases and meeting link context", () => {
    expect(
      extractMeetingEntities(
        [
          {
            id: "segment_1",
            text: "The Nascent follow up should include the shared SAFE notes.",
          },
        ],
        {
          attendeeEmails: ["alice@iosg.vc", "founder@nascent.xyz"],
          meetingUrl: "https://meet.google.com/abc-defg-hij",
          transcriptEntities: [
            {
              source: "elevenlabs",
              type: "organization",
              value: "Nascent.xyz",
            },
          ],
          workspaceDomain: "iosg.vc",
        },
      ),
    ).toEqual([
      {
        aliases: ["Nascent.xyz"],
        segmentId: "segment_1",
        source: "elevenlabs",
        type: "organization",
        value: "Nascent",
        normalizedValue: "nascent",
      },
      {
        aliases: [],
        segmentId: "segment_1",
        source: "transcript",
        type: "product",
        value: "SAFE",
        normalizedValue: "safe",
      },
      {
        aliases: ["https://meet.google.com/abc-defg-hij"],
        segmentId: null,
        source: "meeting_url",
        type: "meeting_link",
        value: "meet.google.com",
        normalizedValue: "meet.google.com/abc-defg-hij",
      },
    ]);
  });

  it("adds CRM company domains as organization aliases", () => {
    expect(
      extractMeetingEntities(
        [
          {
            id: "segment_1",
            text: "Babylon mentioned the raise.",
          },
        ],
        {
          organizationDomains: [
            {
              domain: "babylonlabs.io",
              name: "Babylon Labs",
            },
          ],
          transcriptEntities: [
            {
              source: "elevenlabs",
              type: "organization",
              value: "Babylon",
            },
          ],
        },
      ),
    ).toEqual([
      {
        aliases: ["babylonlabs.io"],
        segmentId: "segment_1",
        source: "elevenlabs",
        type: "organization",
        value: "Babylon",
        normalizedValue: "babylon",
      },
    ]);
  });

  it("skips personal email providers when adding calendar organization entities", () => {
    expect(
      extractMeetingEntities([], {
        attendeeEmails: ["person@gmail.com", "partner@nascent.xyz"],
        workspaceDomain: "iosg.vc",
      }),
    ).toEqual([
      {
        aliases: ["nascent.xyz"],
        segmentId: null,
        source: "calendar",
        type: "organization",
        value: "Nascent",
        normalizedValue: "nascent",
      },
    ]);
  });

  it("classifies emotion from words and talk speed", () => {
    expect(
      classifySegmentEmotion({
        text: "This is a hard problem and the deadline risk is real.",
        startMs: 0,
        endMs: 8000,
      }),
    ).toMatchObject({ label: "hard" });

    expect(
      classifySegmentEmotion({
        text: "Cool, this is fine and we can take it step by step.",
        startMs: 0,
        endMs: 30000,
      }),
    ).toMatchObject({ label: "chill" });
  });

  it("does not group meetings by entity alone", () => {
    expect(
      groupRelatedMeetings([
        {
          id: "meeting_1",
          title: "Nascent intro",
          startedAt: "2026-06-20T10:00:00.000Z",
          primaryEntity: "nascent",
        },
        {
          id: "meeting_2",
          title: "Portfolio review",
          startedAt: "2026-06-27T10:00:00.000Z",
          primaryEntity: "nascent",
        },
        {
          id: "meeting_3",
          title: "Internal sync",
          startedAt: "2026-06-26T10:00:00.000Z",
          primaryEntity: null,
        },
      ]),
    ).toEqual([
      {
        id: "meeting_2",
        relatedMeetings: [],
      },
      {
        id: "meeting_3",
        relatedMeetings: [],
      },
      {
        id: "meeting_1",
        relatedMeetings: [],
      },
    ]);
  });

  it("groups related meetings by stable meeting title", () => {
    expect(
      groupRelatedMeetings([
        {
          id: "meeting_1",
          title: "David <> YP",
          startedAt: "2026-06-20T10:00:00.000Z",
          primaryEntity: null,
        },
        {
          id: "meeting_2",
          title: "David <> YP",
          startedAt: "2026-06-27T10:00:00.000Z",
          primaryEntity: null,
        },
      ]),
    ).toEqual([
      {
        id: "meeting_2",
        relatedMeetings: [
          {
            id: "meeting_1",
            title: "David <> YP",
            startedAt: "2026-06-20T10:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("groups related meetings when title punctuation differs", () => {
    expect(
      groupRelatedMeetings([
        {
          id: "meeting_1",
          title: "Internal Meeting - Investment Strategy",
          startedAt: "2026-06-20T10:00:00.000Z",
          primaryEntity: null,
        },
        {
          id: "meeting_2",
          title: "Internal Meeting Investment Strategy",
          startedAt: "2026-06-27T10:00:00.000Z",
          primaryEntity: null,
        },
      ]),
    ).toEqual([
      {
        id: "meeting_2",
        relatedMeetings: [
          {
            id: "meeting_1",
            title: "Internal Meeting - Investment Strategy",
            startedAt: "2026-06-20T10:00:00.000Z",
          },
        ],
      },
    ]);
  });

  it("does not group generic meeting titles", () => {
    expect(
      groupRelatedMeetings([
        {
          id: "meeting_1",
          title: "Zoom Meeting",
          startedAt: "2026-06-20T10:00:00.000Z",
          primaryEntity: null,
        },
        {
          id: "meeting_2",
          title: "Zoom Meeting",
          startedAt: "2026-06-27T10:00:00.000Z",
          primaryEntity: null,
        },
      ]),
    ).toEqual([
      {
        id: "meeting_2",
        relatedMeetings: [],
      },
      {
        id: "meeting_1",
        relatedMeetings: [],
      },
    ]);
  });

  it("groups related meetings by similar external participants", () => {
    expect(
      groupRelatedMeetings([
        {
          id: "meeting_1",
          title: "Founder intro",
          startedAt: "2026-06-20T10:00:00.000Z",
          primaryEntity: null,
          externalParticipantKeys: ["founder@nascent.xyz"],
        },
        {
          id: "meeting_2",
          title: "Founder follow up",
          startedAt: "2026-06-27T10:00:00.000Z",
          primaryEntity: null,
          externalParticipantKeys: ["founder@nascent.xyz"],
        },
        {
          id: "meeting_3",
          title: "Other founder",
          startedAt: "2026-06-26T10:00:00.000Z",
          primaryEntity: null,
          externalParticipantKeys: ["guest@other.xyz"],
        },
      ]),
    ).toEqual([
      {
        id: "meeting_2",
        relatedMeetings: [
          {
            id: "meeting_1",
            title: "Founder intro",
            startedAt: "2026-06-20T10:00:00.000Z",
          },
        ],
      },
      {
        id: "meeting_3",
        relatedMeetings: [],
      },
    ]);
  });
});
