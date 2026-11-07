/** "2h 10m", "45m", "<1m" for time spent with someone. */
export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ms > 0 ? "<1m" : "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? words[0][0] + words.at(-1)![0] : words[0].slice(0, 1)).toUpperCase();
}

const personalDomains = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "yahoo.com", "proton.me", "protonmail.com", "qq.com", "163.com", "126.com"]);

/** The person's organization website, from a work email domain. */
export function workDomain(emails: string[]) {
  for (const email of emails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !personalDomains.has(domain)) return domain;
  }
  return null;
}
