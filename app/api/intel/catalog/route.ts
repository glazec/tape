import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { IntelCapacityError } from "@/lib/intel/content";
import { browserCatalog, buildCatalog } from "@/lib/intel/provenance";
import { loadIntelMeetings, loadIntelHistory } from "@/lib/intel/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  try {
    const corpus = await loadIntelMeetings(workspace);
    const catalog = buildCatalog(corpus);
    const history = await loadIntelHistory(workspace, corpus, catalog);
    return Response.json({ catalog: browserCatalog(catalog), history }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof IntelCapacityError)) throw error;
    return Response.json({ error: error.message }, { status: 422 });
  }
}
