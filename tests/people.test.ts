import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: { execute: vi.fn() } }));
vi.mock("@/lib/vendors/openrouter", () => ({ createOpenRouterChatCompletion: vi.fn() }));
vi.mock("@/lib/provider-credit", () => ({ assertWorkspaceHasProviderCredit: vi.fn() }));

import { collectPersonFollowup, identityKeys, personNameKey } from "@/lib/people";
import { buildProfileTranscript, groundProfile } from "@/lib/person-profile";
import { describeInterval, summarizeColleagues, summarizeRelationship, talkPercent } from "@/lib/person-relationship";
import { formatDuration, initials, workDomain } from "@/lib/person-format";

const meeting = { id: "m1", title: "Intro", at: "2026-10-01T15:00:00.000Z" };
const evidence = (segmentId: string) => [{ segmentId, quote: "quote" }];

function followup(result: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { sourceHash: "h", result: { todos: [], dynamics: [], research: [], connections: [], ...result }, ...extra };
}

describe("person names", () => {
  it("normalizes names and rejects labels that never identify a person", () => {
    expect(personNameKey("  Hana_Sato ")).toBe("hana sato");
    expect(personNameKey("Speaker 2")).toBeNull();
    expect(personNameKey("Unknown speaker")).toBeNull();
    expect(personNameKey("hana@acme.test")).toBeNull();
    expect(personNameKey("")).toBeNull();
  });

  it("finds likely duplicates through full name, initial or email name", () => {
    const hana = identityKeys("Hana Sato", [], ["hana@acme.test"]);
    expect([...identityKeys("hana.s", [], [])].some(key => hana.has(key))).toBe(true);
    expect([...identityKeys("H. Sato", [], ["hana.sato@gmail.test"])].some(key => hana.has(key))).toBe(true);
    expect([...identityKeys("Mark Lee", [], ["mark@other.test"])].some(key => hana.has(key))).toBe(false);
  });
});

describe("collectPersonFollowup", () => {
  const segmentsById = new Map([
    ["s1", { id: "s1", meetingId: "m1", names: ["Speaker 1", "Alex Chen"] }],
    ["s9", { id: "s9", meetingId: "other", names: ["Alex Chen"] }],
  ]);
  const personNames = new Set([personNameKey("Alex Chen")]);

  it("keeps items that cite this person's own line and name them as the subject", () => {
    const aiFollowup = followup({
      todos: [
        { person: "Alex Chen", text: "Alex Chen will send the deck.", timing: "Friday", evidence: evidence("s1") },
        { person: "Maya", text: "Maya will review.", timing: null, evidence: evidence("s1") },
      ],
      dynamics: [{ person: "Alex Chen", text: "Alex Chen seeks GPU partners.", evidence: evidence("s1") }],
    });
    const found = collectPersonFollowup({ meeting, aiFollowup, segmentsById, personNames, language: "en" });
    expect(found.todos.map(item => [item.text, item.timing, item.segmentId])).toEqual([["Alex Chen will send the deck.", "Friday", "s1"]]);
    expect(found.dynamics).toHaveLength(1);
  });

  it("never attributes another meeting's segment or an identical name with no cited line", () => {
    const aiFollowup = followup({ todos: [{ person: "Alex Chen", text: "Alex Chen will call.", timing: null, evidence: evidence("s9") }] });
    expect(collectPersonFollowup({ meeting, aiFollowup, segmentsById, personNames, language: "en" }).todos).toEqual([]);
  });

  it("uses the viewer's translation and the saved speaker name at generation time", () => {
    const aiFollowup = followup(
      { todos: [{ person: "Old Label", text: "Old Label will send.", timing: null, evidence: evidence("s1") }] },
      {
        speakerNames: { s1: "Old Label" },
        translations: { "zh-CN": { todos: [{ person: "Old Label", text: "Old Label 将发送。", timing: null, evidence: evidence("s1") }], dynamics: [], research: [] } },
      },
    );
    const found = collectPersonFollowup({ meeting, aiFollowup, segmentsById, personNames, language: "zh-CN" });
    expect(found.todos[0].text).toBe("Old Label 将发送。");
  });

  it("matches a first name subject on their own line and shows a translation whose names changed", () => {
    const aiFollowup = followup(
      { todos: [{ person: "Alex", text: "Alex will share the pilot data.", timing: null, evidence: evidence("s1") }] },
      { translations: { "zh-CN": { todos: [{ person: "亚历克斯", text: "亚历克斯将分享试点数据。", timing: null, evidence: evidence("s1") }], dynamics: [], research: [] } } },
    );
    const found = collectPersonFollowup({ meeting, aiFollowup, segmentsById, personNames, language: "zh-CN" });
    expect(found.todos.map(item => item.text)).toEqual(["亚历克斯将分享试点数据。"]);
  });

  it("attributes connections by their speaker segment", () => {
    const connection = { kind: "person", name: "Priya", company: "Acme", title: null, relationship: "knows", context: "Former colleague.", speakerSegmentId: "s1", evidence: [{ segmentId: "s1" }] };
    const aiFollowup = followup({ connections: [connection, { ...connection, name: "Sam", speakerSegmentId: "s2" }] });
    const found = collectPersonFollowup({ meeting, aiFollowup, segmentsById, personNames, language: "en" });
    expect(found.connections.map(item => [item.name, item.relationship])).toEqual([["Priya", "Knows"]]);
  });

  it("ignores unreadable followups", () => {
    expect(collectPersonFollowup({ meeting, aiFollowup: { nope: true }, segmentsById, personNames, language: "en" })).toEqual({ todos: [], dynamics: [], connections: [] });
  });
});

describe("relationship summary", () => {
  const now = new Date("2026-11-07T12:00:00.000Z");
  const at = (iso: string, spoke = true, colleagues = ["Yiping"]) => ({ id: iso, title: "x", at: iso, ownerName: colleagues[0], colleagues, canOpen: true, spoke, talkMs: spoke ? 300 : 0, totalMs: 1000, durationMs: 1_800_000 });

  it("counts past meetings, cadence, recency and talk share", () => {
    const summary = summarizeRelationship([at("2026-09-01T00:00:00.000Z"), at("2026-10-01T00:00:00.000Z"), at("2026-10-31T00:00:00.000Z", false), at("2026-12-01T00:00:00.000Z")], now);
    expect(summary.meetingCount).toBe(3);
    expect(summary.cadence).toBe("about every 4 weeks");
    expect(summary.lastMet).toBe("7 days ago");
    expect(summary.talkShare).toBe(30);
    expect(summary.months).toHaveLength(12);
    expect(summary.months.at(-1)).toMatchObject({ key: "2026-11", count: 0 });
    expect(summary.months.find(month => month.key === "2026-10")).toMatchObject({ count: 2, ms: 3_600_000 });
    expect(summary.totalMs).toBe(5_400_000);
  });

  it("ranks who on the team meets them by meetings, then time, ignoring upcoming", () => {
    const list = [at("2026-10-01T00:00:00.000Z", true, ["Jordan", "Riley"]), at("2026-10-20T00:00:00.000Z", true, ["Jordan"]), at("2026-12-01T00:00:00.000Z", true, ["Riley"])];
    expect(summarizeColleagues(list, now.getTime())).toEqual([
      { name: "Jordan", meetings: 2, durationMs: 3_600_000, lastAt: "2026-10-20T00:00:00.000Z" },
      { name: "Riley", meetings: 1, durationMs: 1_800_000, lastAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("formats time, initials and work domains", () => {
    expect([formatDuration(0), formatDuration(20_000), formatDuration(45 * 60_000), formatDuration(130 * 60_000), formatDuration(120 * 60_000)]).toEqual(["0m", "<1m", "45m", "2h 10m", "2h"]);
    expect([initials("Dana Whitfield"), initials("eds"), initials("")]).toEqual(["DW", "E", "?"]);
    expect(workDomain(["dana@gmail.com", "dana@lumen.test"])).toBe("lumen.test");
    expect(workDomain(["dana@gmail.com"])).toBeNull();
  });

  it("describes intervals and shares in plain words", () => {
    expect(describeInterval(1)).toBe("about daily");
    expect(describeInterval(90)).toBe("about every 3 months");
    expect(talkPercent({ talkMs: 1, totalMs: 1000 })).toBe("<1%");
    expect(talkPercent({ talkMs: 0, totalMs: 1000 })).toBeNull();
  });
});

describe("person profile", () => {
  const segments = [
    { id: "a1", meetingId: "first", startMs: 0, text: "What do you do?", speaker: "Yiping", subject: false },
    { id: "a2", meetingId: "first", startMs: 5000, text: "I ran infra at Stripe for six years.", speaker: "Dana", subject: true },
    { id: "a3", meetingId: "first", startMs: 9000, text: "Unrelated chatter.", speaker: "Yiping", subject: false },
    { id: "b1", meetingId: "recent", startMs: 1000, text: "We are raising a seed round.", speaker: "Dana", subject: true },
  ];
  const meetings = [
    { id: "first", title: "Intro", at: "2025-01-01T00:00:00.000Z" },
    { id: "recent", title: "Catch up", at: "2026-11-01T00:00:00.000Z" },
  ];

  it("sends the subject's lines with the line before each, marked SUBJECT", () => {
    const { transcript, included } = buildProfileTranscript(meetings, segments);
    expect(included.map(segment => segment.id).sort()).toEqual(["a1", "a2", "b1"]);
    expect(transcript).toContain("[a2] SUBJECT: I ran infra at Stripe");
    expect(transcript).not.toContain("Unrelated chatter");
    // The first meeting always fits the budget; the rest run newest first.
    expect(transcript.indexOf("Intro")).toBeLessThan(transcript.indexOf("Catch up"));
  });

  it("drops uncited claims and downgrades unsupported expertise", () => {
    const included = segments.slice(0, 2);
    const skill = (level: string, sources: string[] = []) => ({ level, summary: "Summary — detail.", sources });
    const profile = groundProfile({
      headline: "Founder",
      background: [{ text: "Ran infra at Stripe.", sources: ["a2", "made-up"] }, { text: "Invented claim.", sources: ["zzz"] }],
      role: [], achievements: [], recentFocus: [],
      expertise: { technical: skill("strong", ["a2"]), operational: skill("strong"), business: skill("unclear"), social: skill("working", ["b1"]) },
    }, included);
    expect(profile.background).toEqual([{ text: "Ran infra at Stripe.", sources: ["a2"] }]);
    expect(profile.expertise.technical).toMatchObject({ level: "strong", summary: "Summary, detail." });
    expect(profile.expertise.operational.level).toBe("unclear");
    expect(profile.expertise.social.level).toBe("unclear");
    expect(profile.sources).toEqual({ a2: { meetingId: "first", startMs: 5000 } });
  });
});
