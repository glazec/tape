import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { teamMeetingBotProfiles } from "@/db/schema";
import { DEFAULT_MEETING_BOT_NAME } from "@/lib/meeting-bot-constants";

export type MeetingBotProfile = {
  botName: string;
  avatarJpegBase64: string | null;
};

type UpsertMeetingBotProfileInput = {
  teamId: string;
  botName: string | null | undefined;
  avatarFile?: File | null;
  resetAvatar?: boolean;
};

type ProfileValues = {
  teamId: string;
  botName: string;
  avatarJpegBase64?: string | null;
};

type ProfileUpdate = {
  botName: string;
  updatedAt: Date;
  avatarJpegBase64?: string | null;
};

const MAX_AVATAR_BYTES = 1_000_000;
let defaultMeetingBotAvatarJpegBase64: string | null = null;

export class MeetingBotProfileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingBotProfileInputError";
  }
}

export async function getMeetingBotProfile(
  teamId: string,
): Promise<MeetingBotProfile> {
  const [profile] = await db
    .select({
      botName: teamMeetingBotProfiles.botName,
      avatarJpegBase64: teamMeetingBotProfiles.avatarJpegBase64,
    })
    .from(teamMeetingBotProfiles)
    .where(eq(teamMeetingBotProfiles.teamId, teamId))
    .limit(1);

  return {
    botName: normalizeBotName(profile?.botName) ?? DEFAULT_MEETING_BOT_NAME,
    avatarJpegBase64: profile?.avatarJpegBase64 ?? null,
  };
}

export function getDefaultMeetingBotAvatarJpegBase64() {
  if (!defaultMeetingBotAvatarJpegBase64) {
    defaultMeetingBotAvatarJpegBase64 = readFileSync(
      join(process.cwd(), "assets", "meeting-bot-logo.jpg"),
    ).toString("base64");
  }

  return defaultMeetingBotAvatarJpegBase64;
}

export async function upsertMeetingBotProfile(
  input: UpsertMeetingBotProfileInput,
) {
  const botName = normalizeBotName(input.botName);

  if (!botName) {
    throw new MeetingBotProfileInputError("Bot name is required");
  }

  const avatarJpegBase64 = await readAvatarJpegBase64(input.avatarFile);
  const values: ProfileValues = {
    teamId: input.teamId,
    botName,
  };
  const set: ProfileUpdate = {
    botName,
    updatedAt: new Date(),
  };

  if (input.resetAvatar) {
    values.avatarJpegBase64 = null;
    set.avatarJpegBase64 = null;
  } else if (avatarJpegBase64) {
    values.avatarJpegBase64 = avatarJpegBase64;
    set.avatarJpegBase64 = avatarJpegBase64;
  }

  await db
    .insert(teamMeetingBotProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: [teamMeetingBotProfiles.teamId],
      set,
    });
}

export function getMeetingBotRecallCreateInput(profile: MeetingBotProfile) {
  return {
    botName: profile.botName,
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  };
}

export function getMeetingBotRecallUpdateInput(profile: MeetingBotProfile) {
  return {
    ...(profile.botName !== DEFAULT_MEETING_BOT_NAME
      ? { botName: profile.botName }
      : {}),
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  };
}

export function getMeetingBotMetadata(
  profile: MeetingBotProfile,
): Record<string, string> {
  return profile.botName === DEFAULT_MEETING_BOT_NAME
    ? {}
    : { botName: profile.botName };
}

function normalizeBotName(value: string | null | undefined) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!normalized) {
    return null;
  }

  if (normalized.length > 100) {
    throw new MeetingBotProfileInputError(
      "Bot name must be 100 characters or fewer",
    );
  }

  return normalized;
}

async function readAvatarJpegBase64(file: File | null | undefined) {
  if (!file || file.size === 0) {
    return null;
  }

  const isJpeg =
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name.trim());

  if (!isJpeg) {
    throw new MeetingBotProfileInputError("Bot avatar must be a JPG image");
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw new MeetingBotProfileInputError(
      "Bot avatar must be smaller than 1 MB",
    );
  }

  return Buffer.from(await file.arrayBuffer()).toString("base64");
}
