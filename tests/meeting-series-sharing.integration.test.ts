import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { expect, it, vi } from "vitest";

const database = process.env.TAPE_SHARING_TEST_DATABASE;

it.skipIf(!database)(
  "reviews a manual recording's series, grants once and applies the policy to a later occurrence",
  async () => {
    const url = new URL(database!);
    if (
      url.hostname !== "127.0.0.1" ||
      !["/meeting_note", "/tape_activation_test"].includes(url.pathname)
    ) {
      throw new Error("Use the disposable local sharing database");
    }
    const client = new Client({ connectionString: database });
    await client.connect();
    const team = randomUUID(),
      owner = randomUUID(),
      recipient = randomUUID(),
      calendar = randomUUID();
    const manual = randomUUID(),
      seed = randomUUID(),
      past = randomUUID(),
      unrelated = randomUUID(),
      future = randomUUID();
    const email = "recipient@series.test",
      title = "Investment strategy";
    try {
      await client.query("begin");
      await client.query(
        "insert into teams (id,name) values ($1,'Series test')",
        [team],
      );
      await client.query(
        "insert into users (id,auth_user_id,email) values ($1,'series-owner','owner@series.test'),($2,'series-reader',$3)",
        [owner, recipient, email],
      );
      await client.query(
        "insert into team_memberships (team_id,user_id,role) values ($1,$2,'admin'),($1,$3,'member')",
        [team, owner, recipient],
      );
      await client.query(
        "insert into calendar_connections (id,team_id,user_id,external_calendar_id,account_email) values ($1,$2,$3,'primary','owner@second-calendar.test')",
        [calendar, team, owner],
      );
      async function occurrence(id: string, series: string, day: string) {
        const event = randomUUID();
        const start = `2026-11-${day}T02:00:00Z`;
        await client.query(
          "insert into calendar_events (id,team_id,connection_id,title,starts_at,external_event_id,attendee_emails) values ($1,$2,$3,$4,$5,$6,$7)",
          [
            event,
            team,
            calendar,
            title,
            start,
            `${series}_202611${day}T020000Z`,
            JSON.stringify(["owner@second-calendar.test", "colleague@second-calendar.test"]),
          ],
        );
        await client.query(
          "insert into meetings (id,team_id,owner_user_id,calendar_event_id,title,platform,started_at) values ($1,$2,$3,$4,$5,'google_meet',$6)",
          [id, team, owner, event, title, start],
        );
      }
      await occurrence(seed, "series123", "17");
      await occurrence(past, "series123", "10");
      await occurrence(unrelated, "other123", "09");
      await client.query(
        "insert into meetings (id,team_id,owner_user_id,title,platform,started_at) values ($1,$2,$3,$4,'upload','2026-11-17T02:03:00Z')",
        [manual, team, recipient, title],
      );

      // Execute the production route, policy SQL and calendar reconciliation on
      // this one connection. The outer transaction rolls back the entire fixture.
      function query(parts: TemplateStringsArray, ...values: unknown[]) {
        return {
          text: parts.reduce(
            (sql, part, i) => sql + (i ? `$${i}` : "") + part,
            "",
          ),
          values,
        };
      }
      vi.doMock("@/db/client", () => ({
        db: drizzle(client),
        privilegedDb: drizzle(client),
        databaseSql: {
          async transaction(
            build: (tag: typeof query) => ReturnType<typeof query>[],
          ) {
            const results = [];
            for (const statement of build(query))
              results.push((await client.query(statement)).rows);
            return results;
          },
        },
      }));
      vi.doMock("@/lib/auth", () => ({
        getCurrentUser: async () => ({ email: "owner@series.test" }),
      }));
      vi.doMock("@/lib/workspace", () => ({
        getOrCreateWorkspaceForSessionUser: async () => ({
          userId: owner,
          teamId: team,
          domain: "series.test",
        }),
      }));
      const { POST } = await import(
        "@/app/api/meetings/[meetingId]/share/route"
      );
      const { reconcileMeetingSharingForMeeting } = await import(
        "@/lib/meeting-share-rules"
      );
      const share = async (
        id: string,
        preview: boolean,
        includeRelated = true,
      ) => {
        const response = await POST(
          new Request("https://app.test", {
            method: "POST",
            body: JSON.stringify({ email, preview, includeRelated }),
          }),
          { params: Promise.resolve({ meetingId: id }) },
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      const grants = async () =>
        (
          await client.query(
            "select meeting_id from meeting_access where user_id=$1 and revoked_at is null order by meeting_id",
            [recipient],
          )
        ).rows.map((r) => r.meeting_id);
      await client.query("set local role tape_authenticated");
      await client.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: "series-owner", email: "owner@series.test" }),
      ]);
      const handoff = await share(manual, true);
      expect(handoff).toMatchObject({ calendarMeetingId: seed, shared: false });
      const preview = await share(handoff.calendarMeetingId, true);
      expect(preview.meetings.map((m: { id: string }) => m.id).sort()).toEqual(
        [past, seed].sort(),
      );
      expect(await grants()).toEqual([]);
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await share(seed, false)).toMatchObject({
          shared: true,
          meetingCount: 2,
        });
      }
      await reconcileMeetingSharingForMeeting(unrelated);
      expect(await grants()).toEqual([past, seed].sort());
      // Independently sharing one meeting must survive a later series refresh.
      expect(await share(unrelated, false, false)).toMatchObject({
        shared: true,
      });
      await client.query("reset role");
      await occurrence(future, "series123", "24");
      await reconcileMeetingSharingForMeeting(future);
      await reconcileMeetingSharingForMeeting(future);
      await reconcileMeetingSharingForMeeting(unrelated);
      expect(await grants()).toEqual([past, seed, future, unrelated].sort());
      expect(
        (
          await client.query(
            "select count(*)::int as n from meeting_share_policies where team_id=$1 and scope='related'",
            [team],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await client.query("rollback");
      await client.end();
    }
  },
);
