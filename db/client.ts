import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { databaseEnv } from "@/lib/database-env";
import * as schema from "./schema";

export const databaseSql = neon(databaseEnv.DATABASE_URL);

export const db = drizzle(databaseSql, { schema });
