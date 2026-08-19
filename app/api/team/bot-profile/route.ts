import { getStringFormValue } from "@/lib/form-data";
import { redirectSeeOther } from "@/lib/http-responses";
import {
  MeetingBotProfileInputError,
  upsertMeetingBotProfile,
} from "@/lib/meeting-bot-profile";
import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace();

  if (workspace instanceof Response) {
    return workspace;
  }

  const formData = await request.formData().catch(() => null);
  const botName = getStringFormValue(formData, "botName");
  const avatar = formData?.get("avatar");

  try {
    await upsertMeetingBotProfile({
      teamId: workspace.teamId,
      botName,
      avatarFile: avatar instanceof File ? avatar : null,
      resetAvatar: formData?.get("resetAvatar") === "on",
    });
  } catch (error) {
    if (error instanceof MeetingBotProfileInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json(
      { error: "Bot profile could not be saved" },
      { status: 500 },
    );
  }

  return redirectSeeOther("/settings/team");
}
