export const SITE_NAME = "Tape";
export const REPOSITORY_URL = "https://github.com/glazec/tape";

const DEFAULT_SITE_ORIGIN = "https://tape.inevitable.tech";

export function siteUrl(pathname: string) {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_SITE_ORIGIN;

  return new URL(pathname, origin).toString();
}
