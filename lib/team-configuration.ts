import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { teams } from "@/db/schema";
import { normalizeEmail } from "@/lib/access";

export type TeamShareAudience = {
  emails: string[];
  name: string;
};

export type TeamConfiguration = {
  name: string;
  shareAudience: TeamShareAudience | null;
};

type UpdateTeamConfigurationInput = {
  name: string | null | undefined;
  shareAudienceEmails: string | null | undefined;
  shareAudienceName: string | null | undefined;
  teamId: string;
};

const sharingGroupEmailSchema = z.email().max(320);

export class TeamConfigurationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamConfigurationInputError";
  }
}

export async function getTeamConfiguration(
  teamId: string,
): Promise<TeamConfiguration> {
  const [team] = await db
    .select({
      name: teams.name,
      shareAudienceEmails: teams.shareAudienceEmails,
      shareAudienceName: teams.shareAudienceName,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);

  if (!team) {
    throw new Error("Team not found");
  }

  const emails = normalizeAudienceEmails(team.shareAudienceEmails);
  const audienceName = normalizeOptionalLabel(
    team.shareAudienceName,
    "Sharing group name",
    100,
  );

  return {
    name: team.name,
    shareAudience:
      audienceName && emails.length > 0
        ? { emails, name: audienceName }
        : null,
  };
}

export async function updateTeamConfiguration(
  input: UpdateTeamConfigurationInput,
) {
  const name = normalizeRequiredLabel(input.name, "Team name", 100);
  const shareAudienceName = normalizeOptionalLabel(
    input.shareAudienceName,
    "Sharing group name",
    100,
  );
  const shareAudienceEmails = parseAudienceEmails(input.shareAudienceEmails);

  if (
    shareAudienceName &&
    ["organization", "whole organization"].includes(
      shareAudienceName.toLowerCase(),
    )
  ) {
    throw new TeamConfigurationInputError(
      "Sharing group name must be different from Whole organization",
    );
  }

  if (shareAudienceName?.includes("@")) {
    throw new TeamConfigurationInputError(
      "Sharing group name cannot be an email address",
    );
  }

  if (Boolean(shareAudienceName) !== (shareAudienceEmails.length > 0)) {
    throw new TeamConfigurationInputError(
      "Sharing group name and member emails must be provided together",
    );
  }

  await db
    .update(teams)
    .set({
      name,
      shareAudienceEmails,
      shareAudienceName,
      updatedAt: new Date(),
    })
    .where(eq(teams.id, input.teamId));
}

function parseAudienceEmails(value: string | null | undefined) {
  const parts = typeof value === "string" ? value.split(/[\s,;]+/) : [];
  const emails: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!part.trim()) {
      continue;
    }

    const email = normalizeEmail(part);

    if (!sharingGroupEmailSchema.safeParse(email).success) {
      throw new TeamConfigurationInputError(
        `Invalid sharing group email: ${part}`,
      );
    }

    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }

  if (emails.length > 100) {
    throw new TeamConfigurationInputError(
      "Sharing groups can contain at most 100 email addresses",
    );
  }

  return emails;
}

function normalizeAudienceEmails(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((email): email is string => typeof email === "string")
        .map(normalizeEmail)
        .filter((email) => sharingGroupEmailSchema.safeParse(email).success),
    ),
  );
}

function normalizeRequiredLabel(
  value: string | null | undefined,
  label: string,
  maxLength: number,
) {
  const normalized = normalizeOptionalLabel(value, label, maxLength);

  if (!normalized) {
    throw new TeamConfigurationInputError(`${label} is required`);
  }

  return normalized;
}

function normalizeOptionalLabel(
  value: string | null | undefined,
  label: string,
  maxLength = 100,
) {
  const normalized =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (normalized.length > maxLength) {
    throw new TeamConfigurationInputError(
      `${label} must be ${maxLength} characters or fewer`,
    );
  }

  return normalized || null;
}
