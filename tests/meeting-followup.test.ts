import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  parseMeetingFollowup,
  type FollowupSource,
} from "@/lib/meeting-followup";
import {
  getCurrentMeetingFollowup,
  getFollowupSourceHash,
} from "@/lib/meeting-followup-source";

const source: FollowupSource = {
  title: "Discussion",
  startedAt: "2026-10-22T14:00:00Z",
  segments: [
    {
      id: "one",
      speaker: "Momir Amidzic",
      startMs: 120000,
      text: "We will discuss at IC tomorrow.",
    },
  ],
};
const result = {
  todos: [
    {
      person: "Momir Amidzic",
      text: "Momir Amidzic's team will discuss at IC.",
      timing: "tomorrow",
      evidence: [
        { segmentId: "one", quote: "We will discuss at IC tomorrow." },
      ],
    },
  ],
  dynamics: [], research: [],
};

describe("compact followup grounding", () => {
  const research = {
    question: "Does the optimization reduce cost per successful task?",
    context: "Momir requested evidence of actual customer savings.",
    evidenceToCollect: "Obtain task benchmarks with costs, quality and retries.",
    evidence: [{ segmentId: "research", quote: "We need evidence of actual customer savings." }],
  };
  const researchSource = {
    ...source,
    segments: [...source.segments, { id: "research", speaker: "Momir Amidzic", startMs: 180000, text: research.evidence[0].quote }],
  };

  it("accepts research questions without assigning a speaker as an owner", () => {
    const output = { ...result, research: [research] };
    expect(parseMeetingFollowup(JSON.stringify(output), researchSource)).toEqual(output);
  });

  it("rejects invented research quotes and drops only bad research in lenient mode", () => {
    const bad = { ...research, evidence: [{ segmentId: "research", quote: "Costs fell by 48%." }] };
    const output = { ...result, research: [research, bad] };
    expect(() => parseMeetingFollowup(JSON.stringify(output), researchSource)).toThrow("exactly");
    expect(parseMeetingFollowup(JSON.stringify(output), researchSource, { lenient: true })).toEqual({ ...result, research: [research] });
  });

  it("rejects missing research context and too many research questions", () => {
    for (const items of [[{ ...research, context: "" }], Array(6).fill(research)]) {
      expect(() => parseMeetingFollowup(JSON.stringify({ ...result, research: items }), researchSource)).toThrow();
    }
  });

  it("preserves legacy summaries without fabricating research and still invalidates changed sources", () => {
    const legacy = { todos: result.todos, dynamics: result.dynamics };
    const meeting = {
      ...source, status: "ready", transcriptJobStatus: "completed",
      aiFollowup: { sourceHash: createHash("sha256").update(JSON.stringify([1, source])).digest("hex"), result: legacy },
    };
    expect(getCurrentMeetingFollowup(meeting)).toEqual({ ...legacy, research: [] });
    expect(getCurrentMeetingFollowup({ ...meeting, title: "Changed" })).toBeNull();
    expect(getCurrentMeetingFollowup({ ...meeting, aiFollowup: { ...meeting.aiFollowup, result: { ...legacy, research: [research] } } })).toBeNull();
  });

  it("matches quotes despite curly apostrophes and spacing", () => {
    const curly = {
      ...source,
      segments: [{ ...source.segments[0], text: "We’ll  discuss at IC tomorrow." }],
    };
    const item = {
      ...result.todos[0],
      evidence: [{ segmentId: "one", quote: "We'll discuss at IC tomorrow." }],
    };
    expect(
      parseMeetingFollowup(JSON.stringify({ ...result, todos: [item] }), curly).todos,
    ).toHaveLength(1);
  });

  it("drops only ungrounded items in lenient mode", () => {
    const bad = { ...result.todos[0], person: "Someone Else", text: "Someone Else will follow up." };
    expect(
      parseMeetingFollowup(
        JSON.stringify({ ...result, todos: [result.todos[0], bad] }),
        source,
        { lenient: true },
      ),
    ).toEqual(result);
  });

  it("accepts named team ownership while preserving pronouns in source quotes", () => {
    expect(parseMeetingFollowup(JSON.stringify(result), source)).toEqual(
      result,
    );
  });

  it.each([
    "he",
    "she",
    "they",
    "them",
    "their",
    "his",
    "her",
    "its",
    "we",
    "our",
    "you",
  ])("rejects generated %s references", (pronoun) => {
    const item = {
      ...result.todos[0],
      text: `Momir Amidzic says ${pronoun} will follow up.`,
    };
    expect(() =>
      parseMeetingFollowup(
        JSON.stringify({ todos: [item], dynamics: [], research: [] }),
        source,
      ),
    ).toThrow("pronouns");
  });

  it("rejects pronouns in timing too", () => {
    expect(() =>
      parseMeetingFollowup(
        JSON.stringify({
          ...result,
          todos: [{ ...result.todos[0], timing: "after their IC" }],
        }),
        source,
      ),
    ).toThrow("pronouns");
  });

  it("does not reject a real name containing He or You", () => {
    const named = {
      ...source,
      segments: [{ ...source.segments[0], speaker: "He You" }],
    };
    const item = {
      ...result.todos[0],
      person: "He You",
      text: "He You will discuss at IC.",
    };
    expect(
      parseMeetingFollowup(
        JSON.stringify({ todos: [item], dynamics: [], research: [] }),
        named,
      ).todos,
    ).toHaveLength(1);
  });

  it("distinguishes US and IT acronyms from personal pronouns", () => {
    const item = {
      ...result.todos[0],
      text: "Momir Amidzic will contact US IT teams.",
    };
    expect(
      parseMeetingFollowup(
        JSON.stringify({ todos: [item], dynamics: [], research: [] }),
        source,
      ).todos,
    ).toHaveLength(1);
  });

  it.each([
    { person: "Invented Person" },
    { text: "Their team will discuss at IC." },
    { text: "Momir Amidzicson will discuss at IC." },
    {
      evidence: [
        { segmentId: "old-segment", quote: "We will discuss at IC tomorrow." },
      ],
    },
    { evidence: [{ segmentId: "one", quote: "We will send a term sheet." }] },
    { evidence: [] },
  ])("rejects unsupported identity or evidence %j", (change) => {
    expect(() =>
      parseMeetingFollowup(
        JSON.stringify({
          ...result,
          todos: [{ ...result.todos[0], ...change }],
        }),
        source,
      ),
    ).toThrow();
  });

  it("allows no commitments without manufacturing tasks", () => {
    expect(parseMeetingFollowup('{"todos":[],"dynamics":[],"research":[]}', source)).toEqual({
      todos: [],
      dynamics: [], research: [],
    });
  });

  it("shares a saved followup across different display titles and team aliases", () => {
    const meeting = {
      ...source,
      status: "ready",
      transcriptJobStatus: "completed",
      followupSource: source,
      aiFollowup: { sourceHash: getFollowupSourceHash(source), result },
    };
    const readerView = {
      ...meeting,
      title: "A different workspace title",
      segments: [{ ...source.segments[0], speaker: "Momir" }],
    };
    expect(getCurrentMeetingFollowup(readerView)).toEqual(result);
    expect(getFollowupSourceHash(readerView)).toBe(
      getFollowupSourceHash(meeting),
    );
    expect(
      getCurrentMeetingFollowup({
        ...readerView,
        followupSource: {
          ...source,
          segments: [{ ...source.segments[0], text: "Corrected source" }],
        },
      }),
    ).toBeNull();
  });

  it("invalidates saved content after replacement, correction, name, title or date changes", () => {
    const meeting = {
      ...source,
      status: "ready",
      transcriptJobStatus: "completed",
      aiFollowup: { sourceHash: getFollowupSourceHash(source), result },
    };
    expect(getCurrentMeetingFollowup(meeting)).toEqual(result);
    for (const segmentChange of [
      { id: "new-generation" },
      { speaker: "Corrected Name" },
      { text: "Corrected transcript" },
      { startMs: 200000 },
    ]) {
      expect(
        getCurrentMeetingFollowup({
          ...meeting,
          segments: [{ ...source.segments[0], ...segmentChange }],
        }),
      ).toBeNull();
    }
    expect(
      getCurrentMeetingFollowup({ ...meeting, title: "Renamed" }),
    ).toBeNull();
    expect(
      getCurrentMeetingFollowup({ ...meeting, startedAt: null }),
    ).toBeNull();
    expect(
      getCurrentMeetingFollowup({ ...meeting, status: "processing" }),
    ).toBeNull();
    expect(
      getCurrentMeetingFollowup({ ...meeting, transcriptJobStatus: "running" }),
    ).toBeNull();
    expect(
      getCurrentMeetingFollowup({ ...meeting, aiFollowup: { result } }),
    ).toBeNull();
  });
});
