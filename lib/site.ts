export const SITE_NAME = "Tape";
export const REPOSITORY_URL = "https://github.com/glazec/tape";

const DEFAULT_SITE_ORIGIN = "https://tape.inevitable.tech";

export function siteOrigin() {
  return new URL(
    process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_SITE_ORIGIN,
  ).origin;
}

export function siteUrl(pathname: string) {
  return new URL(pathname, siteOrigin()).toString();
}
