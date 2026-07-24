import { z } from "zod";

const optionalDatabaseUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().url().optional(),
);

const databaseEnvSchema = z.object({
  DATABASE_AUTHENTICATED_URL: optionalDatabaseUrl,
  DATABASE_URL: z.string().trim().url(),
});

function parseDatabaseEnv(source: Record<string, string | undefined>) {
  const parsed = databaseEnvSchema.parse(source);

  if (
    (source.VERCEL_ENV || source.NODE_ENV === "production") &&
    !parsed.DATABASE_AUTHENTICATED_URL
  ) {
    throw new Error(
      "DATABASE_AUTHENTICATED_URL is required for production deployments",
    );
  }

  return {
    ...parsed,
    DATABASE_AUTHENTICATED_URL:
      parsed.DATABASE_AUTHENTICATED_URL ?? parsed.DATABASE_URL,
  };
}

export const databaseEnv = parseDatabaseEnv(process.env);
