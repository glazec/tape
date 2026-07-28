import { revalidateTag } from "next/cache";

import {
  getCachedDashboardSummaryForWorkspace,
  getDashboardSummaryCacheTag,
} from "@/lib/dashboard-summary-cache";
import { getCurrentUser } from "@/lib/auth";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);

  if (workspace.canCreateMeetings === false) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.dashboardSummaryRefresh,
      subject: workspace.userId,
    });

    revalidateTag(getDashboardSummaryCacheTag(workspace), { expire: 0 });
    const result = await getCachedDashboardSummaryForWorkspace(workspace, {
      userEmail: user.email,
      userName: user.name,
    });

    return Response.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const rateLimitResponse = requestRateLimitErrorResponse(error);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    throw error;
  }
}
