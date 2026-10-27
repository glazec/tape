import { getSpeakerIdentityKey } from "@/lib/speaker-labels";

export type SpeakerAlias = {
  alias: string;
  canonicalName: string;
};

export function applySpeakerAliasesToSegments<
  Segment extends { speaker: string | null },
>(segments: Segment[], aliases: SpeakerAlias[]) {
  const aliasMap = buildSpeakerAliasMap(aliases);

  if (aliasMap.size === 0) {
    return segments;
  }

  return segments.map((segment) => {
    const canonicalName = getCanonicalSpeakerName(segment.speaker, aliasMap);

    return canonicalName ? { ...segment, speaker: canonicalName } : segment;
  });
}

export function buildTeamSpeakerAliasRows(input: {
  aliases: Array<string | null>;
  canonicalName: string;
  teamId: string;
}) {
  const canonicalName = input.canonicalName.trim();
  if (!canonicalName || isGenericSpeakerAlias(canonicalName)) return [];
  const emails = new Set(input.aliases.flatMap(alias => {
    const email = alias?.trim().toLowerCase();
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [email] : [];
  }));
  return [...emails].map(email => ({ alias: email, aliasKey: `email:${email}`, canonicalName, teamId: input.teamId }));
}

export function groupSpeakerAliasesByCanonicalKey(aliases: SpeakerAlias[]) {
  const aliasesByCanonicalKey = new Map<string, string[]>();

  for (const speakerAlias of aliases) {
    const canonicalKey = getSpeakerAliasKey(speakerAlias.canonicalName);
    const alias = speakerAlias.alias.trim();

    if (!canonicalKey || !alias) {
      continue;
    }

    const speakerAliases = aliasesByCanonicalKey.get(canonicalKey) ?? [];
    speakerAliases.push(alias);
    aliasesByCanonicalKey.set(canonicalKey, speakerAliases);
  }

  return aliasesByCanonicalKey;
}

function buildSpeakerAliasMap(aliases: SpeakerAlias[]) {
  const aliasMap = new Map<string, string>();

  for (const alias of aliases) {
    const canonicalName = alias.canonicalName.trim();
    const canonicalKey = getSpeakerAliasKey(canonicalName);
    const aliasKey = getSpeakerAliasKey(alias.alias);

    if (!canonicalName || !canonicalKey || !aliasKey) {
      continue;
    }

    aliasMap.set(aliasKey, canonicalName);
    if (!aliasKey.startsWith("email:")) aliasMap.set(canonicalKey, canonicalName);
  }

  return aliasMap;
}

function getCanonicalSpeakerName(
  speaker: string | null,
  aliasMap: Map<string, string>,
) {
  const speakerKey = getSpeakerAliasKey(speaker);

  return speakerKey ? aliasMap.get(speakerKey) ?? null : null;
}

function getSpeakerAliasKey(speaker: string | null) {
  if (speaker && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(speaker.trim())) return `email:${speaker.trim().toLowerCase()}`;
  const speakerKey = getSpeakerIdentityKey(speaker);

  return speakerKey === "__unknown__" ? null : speakerKey;
}

function isGenericSpeakerAlias(label: string) {
  return /^(speaker\s*\d+|unknown speaker)$/i.test(label.trim());
}

export function resolveParticipantSpeakerAliases(aliases: SpeakerAlias[], people: Array<{ name: string | null; email: string | null }>) {
  const names = new Map<string, Set<string>>();
  for (const person of people) {
    if (!person.name?.trim()) continue;
    if (/^(speaker\s*\d+|unknown speaker)$/i.test(person.name.trim())) continue;
    const key = getSpeakerIdentityKey(person.name);
    const emails = names.get(key) ?? new Set<string>();
    emails.add(person.email?.trim().toLowerCase() ?? "");
    names.set(key, emails);
  }
  const remembered = new Map(aliases.map(alias => [alias.alias.trim().toLowerCase(), alias.canonicalName]));
  const resolved = [...names].flatMap(([name, emails]) => {
    const email = emails.size === 1 ? [...emails][0] : "";
    const canonicalName = remembered.get(email);
    return email && canonicalName ? [{ alias: name, canonicalName }] : [];
  });
  return [...aliases, ...resolved];
}
