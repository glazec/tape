/** Comparable form of a speaker or person name; mirrors app_private.person_name_key. */
export function personNameKey(label: string | null | undefined) {
  const value = label?.trim();
  if (!value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  if (/^(speaker\s*\d+|unknown speaker|unknown|guest|participant)$/i.test(value)) return null;
  return value.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim() || null;
}
