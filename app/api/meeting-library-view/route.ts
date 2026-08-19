import { getCurrentUser } from "@/lib/auth";
import { redirectSeeOther } from "@/lib/http-responses";
import { normalizeMeetingLibraryViewConfig } from "@/lib/meeting-library-view-options";
import { saveDefaultMeetingLibraryView } from "@/lib/meeting-library-views";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return redirectSeeOther("/auth/sign-in");
  }

  const [formData, workspace] = await Promise.all([
    request.formData().catch(() => null),
    getOrCreateWorkspaceForSessionUser(user),
  ]);
  const config = normalizeMeetingLibraryViewConfig({
    q: formData?.get("q"),
    scope: formData?.get("scope"),
    status: formData?.get("status"),
    sort: formData?.get("sort"),
  });

  await saveDefaultMeetingLibraryView({ workspace, config });

  return redirectSeeOther("/dashboard?view=my");
}
