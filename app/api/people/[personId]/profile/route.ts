import { z } from "zod";
import { db } from "@/db/client";
import { workspacePeople } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getPersonWorkspace, isPersonColleague } from "@/lib/people";
import { generatePersonProfile } from "@/lib/person-profile";
import { getPersonTimeline, refreshPersonTimeline } from "@/lib/person-timeline-store";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId } = await context.params;
  if (!z.uuid().safeParse(personId).success) return Response.json({ error: "Person not found" }, { status: 404 });
  const workspace = await getPersonWorkspace(user, personId);
  const [person] = await db.select({ id: workspacePeople.id, name: workspacePeople.preferredName }).from(workspacePeople)
    .where(and(eq(workspacePeople.id, personId), eq(workspacePeople.teamId, workspace.teamId), isNull(workspacePeople.mergedIntoId))).limit(1);
  if (!person) return Response.json({ error: "Person not found" }, { status: 404 });
  // Colleagues get no AI profile; the team already knows them.
  if (await isPersonColleague(person.id)) {
    return Response.json({ error: "Profiles are written for people outside the team." }, { status: 400 });
  }
  try {
    const [profile, updated] = await Promise.allSettled([
      generatePersonProfile(workspace, person),
      refreshPersonTimeline(workspace, person.id),
    ]);
    if (profile.status === "rejected") throw profile.reason;
    if (updated.status === "rejected") console.error("person_timeline_generation_failed", { personId, error: String(updated.reason) });
    const timeline = await getPersonTimeline(workspace, person.id);
    return Response.json({
      ...profile.value,
      timeline,
      timelineRemaining: updated.status === "fulfilled" ? updated.value.remaining : 0,
      timelineError: updated.status === "rejected",
    });
  } catch (error) {
    if (error instanceof ProviderCreditExhaustedError) {
      return Response.json({ error: "Your workspace has used its AI credit. Ask an admin to raise the limit." }, { status: 402 });
    }
    console.error("person_profile_generation_failed", { personId, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "Could not write the profile." }, { status: 502 });
  }
}
