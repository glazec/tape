import { z } from "zod";
import { enqueueIntelSearch, readIntelJob } from "@/lib/intel/jobs";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { assertRequestRateLimit, RequestRateLimitError } from "@/lib/request-rate-limit";
import { searchInputSchema } from "@/lib/intel/types";
export const runtime = "nodejs";
export const maxDuration = 600;
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin) return Response.json({ error: "Forbidden" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.text();
  if (body.length > 24000) return Response.json({ error: "Paste up to 20,000 characters." }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(body); } catch { value = null; }
  const parsed = searchInputSchema.safeParse(value);
  if (!parsed.success) return Response.json({ error: "Choose intel, a person, or paste content." }, { status: 400 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  try {
    await assertRequestRateLimit({ limit: 10, scope: "intel_search", subject: `${workspace.teamId}:${workspace.userId}`, windowMs: 60000 });
    return Response.json(await enqueueIntelSearch(workspace, parsed.data), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RequestRateLimitError) return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    return Response.json({ error: "Could not complete this search. Please try again." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null && !z.uuid().safeParse(id).success) return Response.json({ error: "Invalid search" }, { status: 400 });
  const job = await readIntelJob(await getOrCreateWorkspaceForSessionUser(user), id ?? undefined);
  return Response.json({ job }, { status: id && !job ? 404 : 200, headers: { "Cache-Control": "private, no-store" } });
}
