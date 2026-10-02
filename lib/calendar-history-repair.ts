import { databaseSql } from "@/db/client";
import { normalizeEmailDomain } from "@/lib/access";
import { autoJoinCalendarEvent } from "@/lib/calendar-auto-join";
import { fetchGoogleCalendarEvent, fetchGoogleCalendarHistoryEventIds } from "@/lib/google-calendar-events";
import { refreshStoredGoogleCalendarAccessToken } from "@/lib/google-calendar-oauth";
import { normalizeRecallCalendarEvent } from "@/lib/recall-calendar";

export type CalendarHistoryRepairInput = {
  connectionId: string;
  teamId: string;
  userId: string;
  requestedAt: string;
};

const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

export async function listMissingCalendarHistory(input: CalendarHistoryRepairInput) {
  const connection = await findCalendarHistoryConnection(input);
  if (!connection) return [];
  const end = new Date(input.requestedAt);
  const start = new Date(end.getTime() - HISTORY_MS);
  const accessToken = await refreshStoredGoogleCalendarAccessToken(connection.oauth_refresh_token);
  const eventIds = await fetchGoogleCalendarHistoryEventIds({
    accessToken, timeMin: start, timeMax: end,
  });
  const rows = await databaseSql`
    select e.external_event_id
    from calendar_events e
    join calendar_connections c on c.id = e.connection_id
    where c.id = ${input.connectionId}::uuid
      and c.team_id = ${input.teamId}::uuid and c.user_id = ${input.userId}::uuid
      and c.provider = 'google' and c.recall_calendar_status = 'connected'
      and exists (
        select 1 from meetings m where m.team_id = e.team_id
          and (m.calendar_event_id = e.id or
            (e.team_meeting_key is not null and m.team_meeting_key = e.team_meeting_key))
      )
  `;
  const linkedEventIds = new Set(rows.map((row) => String(row.external_event_id)));
  return eventIds.filter((id) => !linkedEventIds.has(id));
}

async function findCalendarHistoryConnection(input: CalendarHistoryRepairInput) {
  // Load credentials inside the step so tokens never enter durable job payloads.
  const [connection] = await databaseSql`
    select c.id, c.team_id, c.user_id, c.oauth_refresh_token, u.email, t.name
    from calendar_connections c
    join users u on u.id = c.user_id
    join teams t on t.id = c.team_id
    where c.id = ${input.connectionId}::uuid
      and c.team_id = ${input.teamId}::uuid and c.user_id = ${input.userId}::uuid
      and c.provider = 'google' and c.recall_calendar_status = 'connected'
    limit 1
  `;
  if (!connection) return null;
  if (typeof connection.oauth_refresh_token !== "string") {
    throw new Error("Calendar history repair requires reconnecting Google Calendar");
  }
  return {
    oauth_refresh_token: connection.oauth_refresh_token,
    email: String(connection.email),
    name: String(connection.name),
  };
}

export async function repairCalendarHistoryEvent(
  input: CalendarHistoryRepairInput,
  externalEventId: string,
) {
  const connection = await findCalendarHistoryConnection(input);
  if (!connection) return { action: "disconnected" };
  const accessToken = await refreshStoredGoogleCalendarAccessToken(connection.oauth_refresh_token);
  const raw = await fetchGoogleCalendarEvent(accessToken, externalEventId);
  if (!raw || raw.status === "cancelled") return { action: "skipped" };
  const start = raw.start as { dateTime?: string } | undefined;
  const end = raw.end as { dateTime?: string } | undefined;
  // All-day events are not recording appointments.
  if (!start?.dateTime) return { action: "skipped" };
  const startsAt = new Date(start.dateTime).getTime();
  const endsAt = end?.dateTime ? new Date(end.dateTime).getTime() : startsAt + 60 * 60 * 1000;
  const now = new Date(input.requestedAt).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) ||
      startsAt < now - HISTORY_MS || startsAt >= now || endsAt > now) {
    return { action: "skipped" };
  }
  const event = normalizeRecallCalendarEvent({
    id: externalEventId, platform_id: externalEventId, raw,
    start_time: start.dateTime, end_time: end?.dateTime,
    ical_uid: raw.iCalUID,
  });
  if (!event) return { action: "skipped" };
  // This is a Google event ID, not a Recall event ID.
  event.recallCalendarEventId = undefined;
  return autoJoinCalendarEvent({
    connection: {
      id: input.connectionId, teamId: input.teamId, userId: input.userId,
      autoJoinEnabled: false,
      workspaceDomain: normalizeEmailDomain(String(connection.email)),
      workspaceName: String(connection.name),
    },
    event, repairMode: true, historicalRepair: true,
  });
}
