import { z } from "zod";

export const noteAnswerSchema = z.strictObject({
  question: z.string().trim().min(1).max(2_000),
  text: z.string().min(1).max(12_000),
  sources: z
    .array(
      z.strictObject({
        segmentId: z.string().min(1).max(100),
        quote: z.string().trim().min(1).max(4_000),
        startMs: z.number().int().nonnegative(),
        speaker: z.string().max(500),
      }),
    )
    .max(20),
  transcriptRevision: z.string().regex(/^[a-f0-9]{64}$/),
  edited: z.boolean().optional(),
});
export type NoteAnswer = z.infer<typeof noteAnswerSchema>;

export const noteBlockSchema = z.strictObject({
  id: z.string().min(1).max(100),
  text: z.string().max(20_000),
  answer: noteAnswerSchema.optional(),
});
export type NoteBlock = z.infer<typeof noteBlockSchema>;

export function noteQuestion(text: string): string | null {
  const lastLine = text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  return /[?？]$/.test(lastLine) &&
    lastLine.length > 1 &&
    lastLine.length <= 2_000
    ? lastLine
    : null;
}

export function noteContent(blocks: NoteBlock[]) {
  return blocks.map((block) => block.text).join("\n");
}

export function normalizeNoteBlocks(
  content: string,
  blocks?: NoteBlock[] | null,
): NoteBlock[] {
  return blocks ?? [{ id: "legacy", text: content }];
}

export const meetingNoteSchema = z
  .strictObject({
    content: z.string().max(20_000),
    version: z.number().int().min(0).max(2_147_483_646),
    blocks: z.array(noteBlockSchema).min(1).max(100).optional(),
  })
  .superRefine((note, context) => {
    if (!note.blocks) return;
    if (noteContent(note.blocks) !== note.content) {
      context.addIssue({
        code: "custom",
        message: "Notes do not match their blocks",
        path: ["blocks"],
      });
    }
    if (
      new Set(note.blocks.map((block) => block.id)).size !== note.blocks.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Note block identifiers must be unique",
        path: ["blocks"],
      });
    }
    if (JSON.stringify(note.blocks).length > 200_000) {
      context.addIssue({
        code: "custom",
        message: "Notes are too large",
        path: ["blocks"],
      });
    }
  });
