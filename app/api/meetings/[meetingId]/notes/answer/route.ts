import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  answerMeetingNoteQuestion,
  getNoteTranscript,
  NoteTranscriptTooLongError,
} from "@/lib/meeting-note-answers";
import { canReadMeetingNotes } from "@/lib/meeting-notes";
import {
  assertMeetingHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
} from "@/lib/request-rate-limit";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 45;

const questionSchema = z.strictObject({
  question: z
    .string()
    .trim()
    .min(2)
    .max(2_000)
    .regex(/[?？]$/),
});
type Context = { params: Promise<{ meetingId: string }> };

async function authorize(context: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success)
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  if (!(await canReadMeetingNotes(workspace, meetingId)))
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  return { workspace, meetingId };
}

export async function GET(_request: Request, context: Context) {
  const access = await authorize(context);
  if (access instanceof Response) return access;
  const { transcriptRevision, hasTranscript } = await getNoteTranscript(
    access.meetingId,
  );
  return Response.json(
    { transcriptRevision, hasTranscript },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request, context: Context) {
  const access = await authorize(context);
  if (access instanceof Response) return access;
  const parsed = questionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Enter a question ending in a question mark." },
      { status: 400 },
    );
  try {
    const transcript = await getNoteTranscript(access.meetingId);
    if (!transcript.hasTranscript)
      return Response.json(
        { error: "Waiting for the transcript.", code: "TRANSCRIPT_PENDING" },
        { status: 409 },
      );
    await assertRequestRateLimit({
      scope: "meeting_note_answer",
      subject: access.workspace.userId,
      limit: 12,
      windowMs: 60_000,
    });
    await assertMeetingHasProviderCredit(access.meetingId);
    const answer = await answerMeetingNoteQuestion(
      access.meetingId,
      parsed.data.question,
      transcript,
    );
    // A replaced or edited transcript must not become a falsely current answer.
    const current = await getNoteTranscript(access.meetingId);
    if (current.transcriptRevision !== transcript.transcriptRevision) {
      return Response.json(
        {
          error: "The transcript changed. Try again for an updated answer.",
          code: "TRANSCRIPT_CHANGED",
        },
        { status: 409 },
      );
    }
    if (!(await canReadMeetingNotes(access.workspace, access.meetingId)))
      return Response.json({ error: "Meeting not found" }, { status: 404 });
    return Response.json(answer, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof NoteTranscriptTooLongError) {
      return Response.json(
        { error: error.message, code: "TRANSCRIPT_TOO_LONG" },
        { status: 413 },
      );
    }
    return (
      requestRateLimitErrorResponse(error) ??
      providerCreditErrorResponse(error) ??
      Response.json(
        { error: "Could not answer from the transcript. Please try again." },
        { status: 502 },
      )
    );
  }
}
