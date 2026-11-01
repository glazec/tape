import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import { MAX_RECORDING_DURATION_MS } from "@/lib/recording-duration";
import { listUploadMeetingCandidates } from "@/lib/upload-meeting-candidates";
import { assertCanCreateMeetings, getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const querySchema = z.object({
  startedAt: z.iso.datetime(),
  durationMs: z.coerce.number().int().positive().max(MAX_RECORDING_DURATION_MS).optional(),
});

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) return Response.json({ error: "Enter a valid recording date and duration" }, { status: 400 });
  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);
    return Response.json(await listUploadMeetingCandidates({
      workspace, startedAt: new Date(result.data.startedAt), durationMs: result.data.durationMs,
    }));
  } catch (error) {
    if (error instanceof SharedOnlyAccessError) {
      return Response.json({ error: "Shared users cannot add meetings" }, { status: 403 });
    }
    return Response.json({ error: "Calendar meetings could not be loaded. Try again." }, { status: 503 });
  }
}
