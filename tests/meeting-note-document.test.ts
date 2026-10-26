import { describe, expect, it } from "vitest";
import { meetingNoteSchema, normalizeNoteBlocks, noteContent, noteQuestion } from "@/lib/meeting-note-document";

const answer = { question: "Check size?", text: "Not mentioned in this transcript yet.", sources: [], transcriptRevision: "a".repeat(64) };

describe("structured personal notes", () => {
  it("recognizes only the last nonempty complete question", () => {
    expect(noteQuestion("Agenda\n\nCheck size?  \n\n")).toBe("Check size?");
    expect(noteQuestion("投资方向？")).toBe("投资方向？");
    expect(noteQuestion("Check size?\nFollow up")).toBeNull();
    expect(noteQuestion("?")).toBeNull();
    expect(noteQuestion(`${"q".repeat(2_001)}?`)).toBeNull();
  });
  it("preserves exact legacy whitespace and stable identity", () => {
    expect(normalizeNoteBlocks("  Agenda\n")).toEqual([{ id: "legacy", text: "  Agenda\n" }]);
    expect(normalizeNoteBlocks("", null)).toEqual([{ id: "legacy", text: "" }]);
  });
  it("derives content from user text only and preserves edited answers", () => {
    const blocks = [{ id: "a", text: "Check size?", answer: { ...answer, edited: true } }, { id: "b", text: "\nMy note" }];
    expect(noteContent(blocks)).toBe("Check size?\n\nMy note");
    expect(normalizeNoteBlocks(noteContent(blocks), blocks)).toBe(blocks);
    expect(meetingNoteSchema.parse({ content: noteContent(blocks), version: 3, blocks }).blocks).toEqual(blocks);
  });
  it("preserves a deliberately cleared answer", () => {
    const blocks = [{ id: "a", text: "Check size?", answer: { ...answer, text: "", edited: true } }];
    expect(meetingNoteSchema.parse({ content: "Check size?", version: 1, blocks }).blocks?.[0].answer?.text).toBe("");
  });
  it.each([
    { content: "other", blocks: [{ id: "a", text: "Question?" }] },
    { content: "x\nx", blocks: [{ id: "a", text: "x" }, { id: "a", text: "x" }] },
    { content: "", blocks: [] },
    { content: "x", blocks: [{ id: "a", text: "x", answer: { ...answer, text: "x".repeat(12_001) } }] },
  ])("rejects inconsistent and unbounded documents", (note) => {
    expect(meetingNoteSchema.safeParse({ ...note, version: 0 }).success).toBe(false);
  });
  it("bounds accumulated answer payloads even when each block is valid", () => {
    const blocks = Array.from({ length: 20 }, (_, i) => ({ id: String(i), text: "Q?", answer: { ...answer, text: "x".repeat(12_000) } }));
    expect(meetingNoteSchema.safeParse({ content: noteContent(blocks), blocks, version: 0 }).success).toBe(false);
  });
});
