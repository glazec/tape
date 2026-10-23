import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { teamMeetingBotProfiles, teams } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { DEFAULT_MEETING_BOT_NAME } from "@/lib/meeting-bot-constants";

export type MeetingBotProfile = {
  botName: string;
  avatarJpegBase64: string | null;
};

type UpsertMeetingBotProfileInput = {
  teamId: string;
  domain?: string;
  preferForSharedMeetings?: boolean;
  botName: string | null | undefined;
  avatarFile?: File | null;
  resetAvatar?: boolean;
};

type ProfileValues = {
  teamId: string;
  domain?: string;
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
  domain?: string,
): Promise<MeetingBotProfile> {
  const [profile] = await db
    .select({
      botName: teamMeetingBotProfiles.botName,
      avatarJpegBase64: teamMeetingBotProfiles.avatarJpegBase64,
    })
    .from(teamMeetingBotProfiles)
    .where(and(eq(teamMeetingBotProfiles.teamId, teamId), eq(teamMeetingBotProfiles.domain, domain ?? "")))
    .limit(1);

  if (!profile && domain) return getMeetingBotProfile(teamId);

  return {
    botName: normalizeBotName(profile?.botName) ?? DEFAULT_MEETING_BOT_NAME,
    avatarJpegBase64: profile?.avatarJpegBase64 ?? null,
  };
}

export async function getCalendarMeetingBotProfile(input: {
  teamId: string;
  accountDomain?: string | null;
  attendeeEmails: string[];
}) {
  const [team] = await db.select({ preferredBotDomain: teams.preferredBotDomain })
    .from(teams).where(eq(teams.id, input.teamId)).limit(1);
  const attendeeDomains = new Set(input.attendeeEmails.map(normalizeEmailDomain));
  const preferred = team?.preferredBotDomain;
  // All calendar copies use the preferred organization's profile when it is invited.
  if (preferred && attendeeDomains.has(preferred)) return getMeetingBotProfile(input.teamId, preferred);
  const profiles = await db.select({ domain: teamMeetingBotProfiles.domain })
    .from(teamMeetingBotProfiles).where(and(
      eq(teamMeetingBotProfiles.teamId, input.teamId),
      inArray(teamMeetingBotProfiles.domain, [...attendeeDomains, ""]),
    )).limit(100);
  const domain = profiles.map((profile) => profile.domain).filter(Boolean).sort()[0] ?? input.accountDomain;
  return getMeetingBotProfile(input.teamId, domain ?? undefined);
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
    ...(input.domain ? { domain: input.domain } : {}),
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
      target: [teamMeetingBotProfiles.teamId, teamMeetingBotProfiles.domain],
      set,
    });

  if (input.preferForSharedMeetings && input.domain) {
    await db.update(teams).set({ preferredBotDomain: input.domain, updatedAt: new Date() })
      .where(eq(teams.id, input.teamId));
  } else if (input.preferForSharedMeetings === false && input.domain) {
    await db.update(teams).set({ preferredBotDomain: null, updatedAt: new Date() })
      .where(and(eq(teams.id, input.teamId), eq(teams.preferredBotDomain, input.domain)));
  }
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
