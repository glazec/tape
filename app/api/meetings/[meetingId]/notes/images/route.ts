import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { canReadMeetingNotes } from "@/lib/meeting-notes";
import { noteImageMaxBytes } from "@/lib/meeting-note-document";
import { assertSafeObjectKeySegment, createReadUrl, meetingNoteImagesPrefix, putObject } from "@/lib/r2";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

type Context = { params: Promise<{ meetingId: string }> };

async function authorize(context: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  if (!(await canReadMeetingNotes(workspace, meetingId))) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  assertSafeObjectKeySegment(workspace.userId, "userId");
  return `${meetingNoteImagesPrefix(meetingId)}${workspace.userId}`;
}

function imageContentType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    return "image/jpeg";
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function POST(request: Request, context: Context) {
  const prefix = await authorize(context);
  if (prefix instanceof Response) return prefix;

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > noteImageMaxBytes) {
        await reader.cancel().catch(() => undefined);
        return Response.json({ error: "Images must be 4 MB or smaller." }, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "Could not read the image." }, { status: 400 });
  }

  const body = Buffer.concat(chunks, size);
  const contentType = imageContentType(body);
  if (!contentType) {
    return Response.json({ error: "Paste a PNG, JPEG, or WebP image." }, { status: 415 });
  }

  const id = randomUUID();
  await putObject({ key: `${prefix}/${id}`, body, contentType });
  return Response.json({ id }, { status: 201 });
}

export async function GET(request: Request, context: Context) {
  const prefix = await authorize(context);
  if (prefix instanceof Response) return prefix;

  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Image not found" }, { status: 404 });

  return new Response(null, {
    status: 307,
    headers: {
      Location: await createReadUrl({ key: `${prefix}/${id.data}` }),
      "Cache-Control": "private, no-store",
    },
  });
}
