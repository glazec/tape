export function getWorkspaceDisplayName(
  workspaceDomain: string,
  configuredName?: string | null,
) {
  const name = configuredName?.replace(/\s+/g, " ").trim();

  if (name) {
    return name;
  }

  const fallback = formatOrganizationName(workspaceDomain);

  return fallback.length <= 4 ? fallback.toUpperCase() : fallback;
}

export function formatOrganizationName(domainOrName: string) {
  const root = domainOrName
    .split("@")
    .pop()
    ?.split(".")[0]
    ?.replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();

  if (!root) {
    return domainOrName;
  }

  return root
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
