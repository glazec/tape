const unknownSpeakerKey = "__unknown__";

export function formatNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? email;
  const words = localPart.split(/[._-]+/).filter(Boolean);

  if (words.length === 0) {
    return email;
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function getSpeakerIdentityKey(speaker: string | null) {
  const comparable = getSpeakerComparableLabel(speaker);

  return comparable
    ? comparable
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, " ")
        .replace(/\s+/g, " ")
    : unknownSpeakerKey;
}

export function getPreferredParticipantSpeakerName(input: {
  email: string | null;
  name: string | null;
}) {
  const name = input.name?.trim() || null;
  const email = input.email?.trim() || null;

  if (name && (!isEmailLikeSpeakerLabel(name) || !email)) {
    return name;
  }

  if (email) {
    return formatNameFromEmail(email);
  }

  return name;
}

export function isEmailLikeSpeakerLabel(label: string) {
  return Boolean(getEmailLikeLocalPart(label));
}

export function isCleanSpeakerFullName(label: string) {
  return getSpeakerNameWords(label).length >= 2 && !/\d/.test(label);
}

export function getSpeakerFirstName(label: string) {
  return getSpeakerNameWords(label)[0]?.toLowerCase() ?? "";
}

export function getUniqueFullNameByFirstName(labels: string[]) {
  const fullNameByFirstName = new Map<string, string | null>();

  for (const label of labels) {
    if (!isCleanSpeakerFullName(label)) {
      continue;
    }

    const firstName = getSpeakerFirstName(label);
    const existing = fullNameByFirstName.get(firstName);

    if (existing === undefined) {
      fullNameByFirstName.set(firstName, label);
      continue;
    }

    if (
      existing !== null &&
      getSpeakerIdentityKey(existing) !== getSpeakerIdentityKey(label)
    ) {
      fullNameByFirstName.set(firstName, null);
    }
  }

  return new Map(
    Array.from(fullNameByFirstName.entries()).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
}

export function getUniqueFullNameForFirstNameAlias(
  alias: string,
  fullNameByFirstName: Map<string, string>,
) {
  if (isCleanSpeakerFullName(alias) || /\d/.test(alias)) {
    return null;
  }

  const words = getSpeakerNameWords(alias);

  return words.length === 1
    ? fullNameByFirstName.get(words[0].toLowerCase()) ?? null
    : null;
}

function getSpeakerComparableLabel(speaker: string | null) {
  const trimmed = speaker?.trim();

  if (!trimmed) {
    return null;
  }

  return getEmailLikeLocalPart(trimmed) ?? trimmed;
}

function getEmailLikeLocalPart(label: string) {
  const atIndex = label.indexOf("@");

  if (atIndex <= 0 || atIndex !== label.lastIndexOf("@")) {
    return null;
  }

  const localPart = label.slice(0, atIndex).trim();
  const domainPart = label.slice(atIndex + 1).trim();

  return localPart && domainPart ? localPart : null;
}

function getSpeakerNameWords(label: string) {
  return label
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
}
