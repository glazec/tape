export type MeetingEmail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments: Array<{ filename: string; content: string; content_type: string }>;
};

export type MeetingEmailSegment = {
  startMs: number;
  speaker: string | null;
  text: string;
};

export function formatEmailTranscript(segments: MeetingEmailSegment[]) {
  return segments.map((segment) => {
    const seconds = Math.floor(segment.startMs / 1000);
    const timestamp = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
    return `[${timestamp}] ${segment.speaker || "Unknown speaker"}: ${segment.text}`;
  }).join("\n");
}

export function splitTranscriptForNotes(transcript: string) {
  const chunks: string[] = [];
  for (let offset = 0; offset < transcript.length;) {
    let end = Math.min(offset + 24000, transcript.length);
    if (end < transcript.length) {
      const newline = transcript.lastIndexOf("\n", end - 1);
      if (newline > offset) end = newline + 1;
      // Keep a UTF16 surrogate pair in the same model request.
      if (/^[\uDC00-\uDFFF]$/.test(transcript[end] ?? "")) end -= 1;
    }
    chunks.push(transcript.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function buildMeetingEmail(input: {
  title: string;
  recipientEmail: string;
  from: string;
  notes: string;
  segments: MeetingEmailSegment[];
}): MeetingEmail {
  const title = input.title.replace(/[\r\n]+/g, " ").trim() || "Meeting";
  const filename = title.replace(/[<>:"/\\|?*\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Meeting";
  return {
    from: input.from,
    to: [input.recipientEmail],
    subject: `Tape: ${title}`,
    text: `Your meeting notes and transcript for "${title}" are attached as TXT files.\n\nNotes are AI generated. Please check important details against the transcript.`,
    attachments: [
      { filename: `${filename} notes.txt`, content: `${title}\n\nAI generated meeting notes\n\n${input.notes}\n` },
      { filename: `${filename} transcript.txt`, content: `${title}\n\nOriginal transcript\n\n${formatEmailTranscript(input.segments)}\n` },
    ].map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.content, "utf8").toString("base64"),
      content_type: "text/plain; charset=utf-8",
    })),
  };
}
