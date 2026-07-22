export function getStringFormValue(
  formData: FormData | null,
  key: string,
) {
  const value = formData?.get(key);

  return typeof value === "string" ? value : null;
}

export function getNormalizedStringFormValue(
  formData: FormData | null,
  key: string,
) {
  return getStringFormValue(formData, key)?.replace(/\s+/g, " ").trim() || null;
}
