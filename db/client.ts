import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { getDatabaseClaimsJson } from "@/db/rls-context";
import { databaseEnv } from "@/lib/database-env";
import * as schema from "./schema";

const administrativeSql = neon(databaseEnv.DATABASE_URL);
const authenticatedSql = neon(databaseEnv.DATABASE_AUTHENTICATED_URL);
const administrativeDb = drizzle(administrativeSql, { schema });
const authenticatedDb = drizzle(authenticatedSql, { schema });

export const privilegedDb = administrativeDb;
export const databaseSql = createTenantAwareSql();
export const db = createTenantAwareDatabase();

function createTenantAwareDatabase(): typeof administrativeDb {
  return new Proxy(administrativeDb, {
    get(_target, property) {
      const claims = getDatabaseClaimsJson();
      const target = claims ? authenticatedDb : administrativeDb;
      const value = Reflect.get(target, property, target);

      if (typeof value !== "function") {
        return claims ? wrapQueryBuilder(value, claims) : value;
      }

      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);

        return claims ? wrapQueryBuilder(result, claims) : result;
      };
    },
  });
}

function wrapQueryBuilder(value: unknown, claims: string): unknown {
  if (!isObjectLike(value)) {
    return value;
  }

  return new Proxy(value, {
    get(target, property) {
      if (property === "then" && isBatchQuery(target)) {
        return (
          onFulfilled?: (result: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          executeAuthenticatedQuery(target, claims).then(
            onFulfilled,
            onRejected,
          );
      }

      const member = Reflect.get(target, property, target);

      if (typeof member !== "function") {
        return wrapQueryBuilder(member, claims);
      }

      return (...args: unknown[]) =>
        wrapQueryBuilder(Reflect.apply(member, target, args), claims);
    },
  });
}

async function executeAuthenticatedQuery(query: object, claims: string) {
  const setClaims = authenticatedDb.execute(
    sql`select set_config('request.jwt.claims', ${claims}, true)`,
  );
  const results = await authenticatedDb.batch([
    setClaims,
    query,
  ] as never);

  return results[1];
}

function createTenantAwareSql(): typeof administrativeSql {
  const query = (
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): ReturnType<typeof administrativeSql> => {
    const claims = getDatabaseClaimsJson();

    if (!claims) {
      return administrativeSql(strings, ...params);
    }

    const statement = authenticatedSql(strings, ...params);
    return authenticatedSql
      .transaction((transaction) => [
        transaction`select set_config('request.jwt.claims', ${claims}, true)`,
        statement,
      ])
      .then((results) => results[1]) as ReturnType<typeof administrativeSql>;
  };
  const contextualSql = query as typeof administrativeSql;

  contextualSql.transaction = ((buildQueries) => {
    const claims = getDatabaseClaimsJson();

    if (!claims) {
      return administrativeSql.transaction(buildQueries as never);
    }

    if (Array.isArray(buildQueries)) {
      const setClaims =
        authenticatedSql`select set_config('request.jwt.claims', ${claims}, true)`;

      return authenticatedSql
        .transaction([setClaims, ...buildQueries] as never)
        .then((results) => results.slice(1));
    }

    return authenticatedSql
      .transaction((transaction) => {
        const queries = Reflect.apply(
          buildQueries,
          undefined,
          [transaction],
        ) as Array<ReturnType<typeof transaction>>;

        return [
          transaction`select set_config('request.jwt.claims', ${claims}, true)`,
          ...queries,
        ];
      })
      .then((results) => results.slice(1));
  }) as typeof administrativeSql.transaction;

  return contextualSql;
}

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function isBatchQuery(value: object) {
  return "_prepare" in value && typeof value._prepare === "function";
}
