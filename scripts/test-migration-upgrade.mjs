import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== "/tape_upgrade_test") {
  throw new Error("Use a fresh local tape_upgrade_test database.");
}

const migrationsFolder = "db/migrations";
const baseline = "0077_mcp_read_performance";
const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"));
const baselineIndex = journal.entries.findIndex(entry => entry.tag === baseline);
if (baselineIndex < 0) throw new Error(`Missing migration ${baseline}`);

const psql = (...args) => execFileSync("psql", [
  databaseUrl.href, "-X", "-v", "ON_ERROR_STOP=1", ...args,
], { stdio: "inherit" });

psql("-c", `
  create schema drizzle;
  create table drizzle.__drizzle_migrations (
    id serial primary key, hash text not null, created_at bigint
  );
`);

// Apply historical migrations separately, as they were deployed. In
// particular, 0011 uses an enum value that 0010 must commit first.
const migrations = readMigrationFiles({ migrationsFolder });
for (const [index, migration] of migrations.slice(0, baselineIndex + 1).entries()) {
  const { tag } = journal.entries[index];
  psql("-q", "-f", `${migrationsFolder}/${tag}.sql`, "-c", `
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values ('${migration.hash}', ${migration.folderMillis})
  `);
}

psql("-v", "seed=1", "-f", "tests/sql/person-migration-upgrade.sql");
for (const attempt of ["upgrade", "repeat"]) {
  console.log(`Checking migration ${attempt}`);
  execFileSync("npm", ["run", "db:migrate"], { stdio: "inherit" });
  psql("-f", "tests/sql/person-migration-upgrade.sql");
  const count = execFileSync("psql", [
    databaseUrl.href, "-XAt", "-v", "ON_ERROR_STOP=1", "-c",
    "select count(*) from drizzle.__drizzle_migrations",
  ], { encoding: "utf8" });
  if (Number(count) !== migrations.length) throw new Error("Unexpected migration journal count.");
}
