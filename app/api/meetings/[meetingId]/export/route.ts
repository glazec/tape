import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.string().uuid();
const transcriptLanguageSchema = z.enum(["original", "zh"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const format = searchParams.get("format") ?? "text";

  if (format === "mp3") {
    return Response.redirect(
      new URL(
        `/api/meetings/${encodeURIComponent(parsedMeetingId.data)}/audio?download=1`,
        request.url,
      ),
    );
  }

  if (format !== "text") {
    return Response.json(
      { error: "Unsupported export format" },
      { status: 400 },
    );
  }

  const parsedLanguage = transcriptLanguageSchema.safeParse(
    searchParams.get("language") ?? "original",
  );

  if (!parsedLanguage.success) {
    return Response.json(
      { error: "Unsupported transcript language" },
      { status: 400 },
    );
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const meetingRows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .limit(1);
  const meeting = meetingRows[0];

  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const segments = await db
    .select({
      speaker: transcriptSegments.speaker,
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
      translatedText: transcriptSegments.translatedText,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meeting.id))
    .orderBy(asc(transcriptSegments.startMs));
  const filename = getTranscriptFilename(meeting.title, parsedLanguage.data);

  return new Response(
    formatTranscriptExport(meeting.title, segments, parsedLanguage.data),
    {
      headers: {
        "content-disposition": `attachment; filename="${filename}"`,
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}

function formatTranscriptExport(
  title: string,
  segments: Array<{
    speaker: string | null;
    startMs: number;
    text: string;
    translatedText: string | null;
  }>,
  language: z.infer<typeof transcriptLanguageSchema>,
) {
  const lines = [
    title,
    "",
    ...segments.map(
      (segment) =>
        `[${formatTimestamp(segment.startMs)}] ${segment.speaker ?? "Unknown speaker"}: ${getTranscriptText(segment, language)}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function getTranscriptText(
  segment: { text: string; translatedText: string | null },
  language: z.infer<typeof transcriptLanguageSchema>,
) {
  if (language === "zh") {
    return segment.translatedText?.trim() || segment.text;
  }

  return segment.text;
}

function getTranscriptFilename(
  title: string,
  language: z.infer<typeof transcriptLanguageSchema>,
) {
  const languageLabel = language === "zh" ? " Chinese" : "";

  return `${sanitizeFilename(title)}${languageLabel} transcript.txt`;
}

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sanitizeFilename(value: string) {
  return (
    value
      .replace(/[^\w .()[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "meeting"
  );
}
