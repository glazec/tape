import { afterEach, describe, expect, it } from "vitest";

import {
  clearDatabaseClaims,
  getDatabaseClaimsJson,
  initializeDatabaseClaimsContext,
  markDatabaseSessionAdmin,
  setDatabaseSessionUser,
  setDatabaseWorkspace,
} from "@/db/rls-context";

describe("database RLS context", () => {
  afterEach(() => {
    clearDatabaseClaims();
  });

  it("keeps verified identity and workspace claims across awaits", async () => {
    await Promise.resolve();
    setDatabaseSessionUser({
      email: " Member@Example.com ",
      id: "auth-user-1",
      name: "Member",
    });
    setDatabaseWorkspace({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
    });
    await Promise.resolve();

    expect(JSON.parse(getDatabaseClaimsJson() ?? "{}")).toEqual({
      app_context_trusted: true,
      app_team_id: "22222222-2222-4222-8222-222222222222",
      app_user_id: "11111111-1111-4111-8111-111111111111",
      email: "member@example.com",
      name: "Member",
      sub: "auth-user-1",
    });
  });

  it("keeps claims written by an awaited authentication helper", async () => {
    initializeDatabaseClaimsContext();

    await (async () => {
      await Promise.resolve();
      setDatabaseSessionUser({
        email: "member@example.com",
        id: "auth-user-1",
      });
    })();

    expect(JSON.parse(getDatabaseClaimsJson() ?? "{}")).toMatchObject({
      email: "member@example.com",
      sub: "auth-user-1",
    });
  });

  it("adds global administration only after application verification", () => {
    setDatabaseSessionUser({
      email: "yiping@iosg.vc",
      id: "auth-admin",
    });
    markDatabaseSessionAdmin();

    expect(JSON.parse(getDatabaseClaimsJson() ?? "{}")).toMatchObject({
      app_context_trusted: true,
      app_global_admin: true,
      sub: "auth-admin",
    });
  });

  it("isolates claims between concurrent request contexts", async () => {
    const readClaims = async (id: string, email: string) => {
      await Promise.resolve();
      setDatabaseSessionUser({ email, id });
      await new Promise((resolve) => setTimeout(resolve, 0));

      return JSON.parse(getDatabaseClaimsJson() ?? "{}");
    };

    const [first, second] = await Promise.all([
      readClaims("auth-a", "a@example.com"),
      readClaims("auth-b", "b@example.com"),
    ]);

    expect(first).toMatchObject({ email: "a@example.com", sub: "auth-a" });
    expect(second).toMatchObject({ email: "b@example.com", sub: "auth-b" });
  });
});
