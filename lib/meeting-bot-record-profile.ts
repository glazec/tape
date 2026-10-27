import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarConnections, calendarEvents, meetings } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { getCalendarMeetingBotProfile, getMeetingBotProfile } from "@/lib/meeting-bot-profile";

// Existing meetings retain their explicit bot identity. Calendar-created records
// without an override keep the organization's attendee preference.
export async function getBotProfileForMeeting(meetingId: string) {
  const [meeting] = await db.select({
    teamId: meetings.teamId,
    organizationDomain: meetings.botOrganizationDomain,
    botDisplayName: meetings.botDisplayName,
    attendeeEmails: calendarEvents.attendeeEmails,
    accountEmail: calendarConnections.accountEmail,
  }).from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .leftJoin(calendarConnections, eq(calendarConnections.id, calendarEvents.connectionId))
    .where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) throw new Error("Meeting unavailable");
  const profile = await (meeting.organizationDomain != null
    ? getMeetingBotProfile(meeting.teamId, meeting.organizationDomain || undefined)
    : getCalendarMeetingBotProfile({
        teamId: meeting.teamId,
        attendeeEmails: meeting.attendeeEmails ?? [],
        accountDomain: meeting.accountEmail ? normalizeEmailDomain(meeting.accountEmail) : undefined,
      }));
  return { ...profile, botName: meeting.botDisplayName || profile.botName };
}
