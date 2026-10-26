import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

const { databaseSql } = vi.hoisted(() => ({ databaseSql: vi.fn() }));
vi.mock("@/db/client", () => ({ databaseSql }));
import { listShareRecipientSuggestions } from "@/lib/share-recipient-suggestions";

const testDatabase = process.env.TAPE_SHARING_TEST_DATABASE;

// Run only against a disposable local database with all migrations applied.
describe.skipIf(!testDatabase)("sharing suggestions under real tenant RLS", () => {
  it("includes both organizations and previous guests without exposing unrelated teams", async () => {
    const url = new URL(testDatabase!);
    if (url.hostname !== "127.0.0.1" || !["/tape_activation_test", "/meeting_note"].includes(url.pathname)) {
      throw new Error("Use the isolated local tape_activation_test database");
    }
    databaseSql.mockResolvedValue([]);
    await listShareRecipientSuggestions({ userId: "20000000-0000-4000-8000-000000000001", teamId: "10000000-0000-4000-8000-000000000001", domain: "one.test" });
    const [parts, ...values] = databaseSql.mock.calls[0] as [TemplateStringsArray, ...string[]];
    const query = parts.reduce((text, part, index) => text + part + (index < values.length ? `'${values[index].replaceAll("'", "''")}'` : ""), "");
    const output = execFileSync("psql", [testDatabase!, "-X", "-At", "-v", "ON_ERROR_STOP=1"], {
      encoding: "utf8",
      input: `begin;
        insert into teams (id, name) values
          ('10000000-0000-4000-8000-000000000001', 'First organization'),
          ('10000000-0000-4000-8000-000000000002', 'Second organization'),
          ('10000000-0000-4000-8000-000000000003', 'Unrelated organization');
        insert into users (id, auth_user_id, email, name) values
          ('20000000-0000-4000-8000-000000000001', 'suggestion-owner', 'owner@one.test', 'Owner'),
          ('20000000-0000-4000-8000-000000000002', 'suggestion-first', 'member@one.test', 'First'),
          ('20000000-0000-4000-8000-000000000003', 'suggestion-second', 'member@two.test', 'Second'),
          ('20000000-0000-4000-8000-000000000004', 'suggestion-private', 'private@three.test', 'Private');
        insert into team_memberships (team_id, user_id, role) values
          ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'member'),
          ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'member'),
          ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member'),
          ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'member'),
          ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004', 'member');
        insert into allowed_domains (team_id, domain) values
          ('10000000-0000-4000-8000-000000000001', 'one.test'),
          ('10000000-0000-4000-8000-000000000002', 'two.test');
        insert into calendar_connections (id, team_id, user_id, external_calendar_id) values
          ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'primary');
        insert into calendar_events (team_id, connection_id, external_event_id, title, starts_at, attendee_emails) values
          ('10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'test', 'Test', now(), '["unregistered@two.test", "unrelated@outside.test", "member@two.test"]');
        insert into meetings (id, team_id, owner_user_id, title, platform) values
          ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Test', 'zoom');
        insert into meeting_share_policies (team_id, owner_user_id, seed_meeting_id, recipient_email, scope, created_by_user_id) values
          ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'guest@outside.test', 'single', '20000000-0000-4000-8000-000000000001');
        set local role tape_authenticated;
        select set_config('request.jwt.claims', '{"sub":"suggestion-owner","email":"owner@one.test"}', true);
        select coalesce(jsonb_agg(result), '[]'::jsonb) from (${query}) result;
        rollback;`,
    });
    const rows = JSON.parse(output.split("\n").find((line) => line.startsWith("["))!);
    expect(rows.map((row: { email: string }) => row.email)).toEqual([
      "guest@outside.test", "member@one.test", "member@two.test", "unregistered@two.test",
    ]);
    expect(rows.find((row: { email: string }) => row.email === "member@two.test").organization).toBe("Second organization");
  });
});
