import { describe, expect, it } from "vitest";
import {
  parseNoteMoments,
  reconcileNoteMoments,
  resolveNoteMoment,
} from "@/lib/note-moments";
import { meetingNoteSchema } from "@/lib/meeting-note-document";
const anchor = {
  start: 0,
  text: "[0:30]",
  sourceMeetingId: "source",
  capturedAt: "2026-10-31T10:10:30Z",
};
describe("note moments", () => {
  it("parses explicit minute and hour timestamps without accepting invalid seconds", () => {
    expect(
      parseNoteMoments("A [12:34] B [1:02:34] [1:99] [text]").map(
        (m) => m.timestampMs,
      ),
    ).toEqual([754000, 3754000]);
  });
  it("preserves anchor metadata in the strict note document", () => {
    const blocks = [{ id: "one", text: "[0:30] Budget", moments: [anchor] }];
    expect(
      meetingNoteSchema.parse({ content: blocks[0].text, blocks, version: 0 })
        .blocks,
    ).toEqual(blocks);
  });
  it("moves anchor ranges on insert and removes anchors when their text is edited", () => {
    expect(
      reconcileNoteMoments("[0:30] Budget", "Note [0:30] Budget", [anchor]),
    ).toEqual([{ ...anchor, start: 5 }]);
    expect(
      reconcileNoteMoments("[0:30] Budget", "[0:40] Budget", [anchor]),
    ).toEqual([]);
  });
  it("keeps the correct anchor when identical markers are deleted", () => {
    const first = {
      ...anchor,
      text: "[Moment]",
      capturedAt: "2026-10-31T10:00:30Z",
    };
    const second = { ...first, start: 11, capturedAt: "2026-10-31T10:10:30Z" };
    expect(
      reconcileNoteMoments(
        "[Moment] A [Moment] B",
        "[Moment] B",
        [first, second],
        0,
      ),
    ).toEqual([{ ...second, start: 0 }]);
  });
  it("resolves a resumed recording through captured intervals, excluding the gap", () => {
    const parts = [
      {
        startedAt: "2026-10-31T10:00:00Z",
        endedAt: "2026-10-31T10:02:00Z",
        durationMs: 120000,
      },
      {
        startedAt: "2026-10-31T10:10:00Z",
        endedAt: "2026-10-31T10:11:00Z",
        durationMs: 60000,
      },
    ];
    expect(resolveNoteMoment(anchor, parts)).toBe(150000);
    expect(
      resolveNoteMoment(
        { ...anchor, capturedAt: "2026-10-31T10:05:00Z" },
        parts,
      ),
    ).toBeNull();
    expect(
      resolveNoteMoment(anchor, [{ ...parts[0], durationMs: null }, parts[1]]),
    ).toBeNull();
  });
});
