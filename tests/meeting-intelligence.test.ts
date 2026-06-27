import { describe, expect, it } from "vitest";

import {
  buildSmartMeetingTitle,
  buildTeamVocabularyKeyterms,
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
        segmentId: "segment_1",
        type: "organization",
        value: "Nascent",
        normalizedValue: "nascent",
      },
      {
        segmentId: "segment_1",
        type: "product",
        value: "Solana",
        normalizedValue: "solana",
      },
      {
        segmentId: "segment_1",
        type: "product",
        value: "TCG",
        normalizedValue: "tcg",
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

  it("groups related meetings under the newest meeting with the same entity", () => {
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
          title: "Nascent follow up",
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
        relatedMeetings: [
          {
            id: "meeting_1",
            title: "Nascent intro",
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
