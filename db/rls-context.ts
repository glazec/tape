import { AsyncLocalStorage } from "node:async_hooks";

type DatabaseClaims = {
  app_global_admin?: boolean;
  app_context_trusted: true;
  app_team_id?: string;
  app_user_id?: string;
  email?: string;
  name?: string | null;
  sub: string;
};

type DatabaseClaimsContext = {
  claims: DatabaseClaims | null;
};

const databaseClaimsStorage =
  new AsyncLocalStorage<DatabaseClaimsContext>();

export function initializeDatabaseClaimsContext() {
  databaseClaimsStorage.enterWith({ claims: null });
}

export function setDatabaseSessionUser(input: {
  email: string;
  globalAdmin?: boolean;
  id: string;
  name?: string | null;
}) {
  getOrCreateContext().claims = {
    app_context_trusted: true,
    ...(input.globalAdmin ? { app_global_admin: true } : {}),
    email: input.email.trim().toLowerCase(),
    name: input.name ?? null,
    sub: input.id,
  };
}

export function setDatabaseWorkspace(input: {
  teamId: string;
  userId: string;
}) {
  const context = getOrCreateContext();
  const claims = context.claims;

  if (!claims) {
    context.claims = {
      app_context_trusted: true,
      app_team_id: input.teamId,
      app_user_id: input.userId,
      sub: `workspace:${input.userId}`,
    };
    return;
  }

  context.claims = {
    ...claims,
    app_team_id: input.teamId,
    app_user_id: input.userId,
  };
}

export function markDatabaseSessionAdmin() {
  const context = databaseClaimsStorage.getStore();
  const claims = context?.claims;

  if (context && claims) {
    context.claims = {
      ...claims,
      app_global_admin: true,
    };
  }
}

export function clearDatabaseClaims() {
  getOrCreateContext().claims = null;
}

export function getDatabaseClaimsJson() {
  const claims = databaseClaimsStorage.getStore()?.claims;

  return claims ? JSON.stringify(claims) : null;
}

function getOrCreateContext() {
  const context = databaseClaimsStorage.getStore();

  if (context) {
    return context;
  }

  const nextContext: DatabaseClaimsContext = { claims: null };
  databaseClaimsStorage.enterWith(nextContext);
  return nextContext;
}
