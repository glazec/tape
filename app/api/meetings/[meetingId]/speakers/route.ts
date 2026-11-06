import { z } from "zod";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { mutateSpeakerIdentity, speakerIdentityError, speakerUpdateSchema } from "@/lib/speaker-identity";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: {params: Promise<{meetingId:string}>}) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:"Unauthorized"}, {status:401});
  const result = speakerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) return Response.json({error:"Invalid speaker label"}, {status:400});
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) return Response.json({error:"Meeting not found"}, {status:404});
  const workspace = await getOrCreateWorkspaceForSessionUser(user, {meetingId});
  const [meeting] = await db.select({id:meetings.id}).from(meetings).where(getManageableMeetingCondition(workspace,meetingId)).limit(1);
  if (!meeting) return Response.json({error:"Meeting not found"}, {status:404});
  try { return Response.json(await mutateSpeakerIdentity(meetingId,result.data)); }
  catch (error) { const response = speakerIdentityError(error); if (response) return response; throw error; }
}
