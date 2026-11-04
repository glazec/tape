import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { assertRequestRateLimit, RequestRateLimitError } from "@/lib/request-rate-limit";
import { providerCreditErrorResponse } from "@/lib/provider-credit";
import { searchInputSchema } from "@/lib/intel/types";
import { loadIntelMeetings, saveIntelHistory } from "@/lib/intel/store";
import { searchIntel } from "@/lib/intel/search";
import { IntelInputError } from "@/lib/intel/content";
export const runtime = "nodejs";
export const maxDuration = 240;
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
    const corpus = await loadIntelMeetings(workspace);
    const result = await searchIntel(workspace, parsed.data, corpus);
    const historyId = await saveIntelHistory(workspace, parsed.data);
    return Response.json({ ...result, historyId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const credit = providerCreditErrorResponse(error); if (credit) return credit;
    if (error instanceof RequestRateLimitError) return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof IntelInputError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: "Could not complete this search. Please try again." }, { status: 502 });
  }
}
