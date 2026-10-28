import { getStringFormValue } from "@/lib/form-data";
import { redirectSeeOther } from "@/lib/http-responses";
import {
  MeetingBotProfileInputError,
  upsertMeetingBotProfile,
} from "@/lib/meeting-bot-profile";
import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";
import { getOrganizationBotSettings } from "@/lib/organization-workspaces";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace(request);

  if (workspace instanceof Response) {
    return workspace;
  }

  const formData = await request.formData().catch(() => null);
  const botName = getStringFormValue(formData, "botName");
  const avatar = formData?.get("avatar");
  const domain = new URL(request.url).searchParams.get("organizationDomain");
  if (domain) {
    const settings = await getOrganizationBotSettings(workspace.teamId);
    if (!settings.domains.includes(domain)) {
      return Response.json({ error: "Unknown organization domain" }, { status: 400 });
    }
  }

  try {
    await upsertMeetingBotProfile({
      teamId: workspace.teamId,
      ...(domain ? { domain, preferForSharedMeetings: formData?.get("preferForSharedMeetings") === "on" } : {}),
      botName,
      avatarFile: avatar instanceof File ? avatar : null,
      resetAvatar: formData?.get("resetAvatar") === "on",
    });
  } catch (error) {
    if (error instanceof MeetingBotProfileInputError) {
      console.warn("bot_profile_rejected", {
        avatarSize: avatar instanceof File ? avatar.size : null,
        avatarType: avatar instanceof File ? avatar.type : null,
        reason: error.message,
      });
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json(
      { error: "Bot profile could not be saved" },
      { status: 500 },
    );
  }

  return redirectSeeOther(`/settings/team?teamId=${workspace.teamId}${domain ? `&organizationDomain=${encodeURIComponent(domain)}` : ""}`);
}
