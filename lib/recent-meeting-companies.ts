import { and, desc, eq, lte, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { calendarConnections, calendarEvents, meetings, meetingAttendees } from "@/db/schema";

const personalDomains = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "yahoo.com", "qq.com", "163.com", "proton.me", "protonmail.com"]);
const genericTitle = /^(meeting|intro|introduction|sync|catch up|catchup|call|weekly|monthly|discussion|follow up|zoom|google meet)(\s|$)/i;

export function collectRecentCompanyHints(events: Array<{ title: string; attendeeEmails: string[] }>, seen = new Set<string>()) {
  const companies: string[] = [];
  const add = (value: string) => {
    const name = value.trim().replace(/\s+/g, " ").slice(0, 160);
    const key = name.toLowerCase().replace(/\.(?:co\.uk|com\.au|co\.jp|[a-z]{2,})$/, "").replace(/[^\p{L}\p{N}]/gu, "");
    if (key.length < 2 || seen.has(key) || seen.size >= 100) return;
    seen.add(key);
    companies.push(name);
  };
  for (const event of events) {
    for (const name of event.title.split(/\s+(?:x|×|&|with|and|vs\.?|\||\/|\u2013|\u2014|-)\s+|\s*<>\s*/i)) {
      if (!genericTitle.test(name.trim()) && !/@|https?:/i.test(name)) add(name);
    }
    for (const email of event.attendeeEmails) {
      const domain = email.trim().toLowerCase().split("@")[1];
      if (domain && !personalDomains.has(domain)) add(domain);
    }
    if (seen.size === 100) break;
  }
  return companies;
}

export async function getRecentMeetingCompanies(userId: string) {
  const calendar = db.select({ title: calendarEvents.title, attendeeEmails: calendarEvents.attendeeEmails,
    time: sql<Date>`${calendarEvents.startsAt}`.as("time"), id: calendarEvents.id,
  }).from(calendarEvents).innerJoin(calendarConnections, eq(calendarConnections.id, calendarEvents.connectionId))
    .where(and(eq(calendarConnections.userId, userId), lte(calendarEvents.startsAt, new Date())));
  const captured = db.select({ title: meetings.title,
    attendeeEmails: sql<string[]>`coalesce(jsonb_agg(${meetingAttendees.email} order by ${meetingAttendees.email}) filter (where ${meetingAttendees.email} is not null), '[]'::jsonb)`.as("attendee_emails"),
    time: sql<Date>`coalesce(${meetings.startedAt}, ${meetings.createdAt})`.as("time"), id: meetings.id,
  }).from(meetings).leftJoin(meetingAttendees, eq(meetingAttendees.meetingId, meetings.id))
    .where(and(eq(meetings.ownerUserId, userId), eq(meetings.status, "ready"))).groupBy(meetings.id);
  const history = unionAll(calendar, captured).as("history");
  const seen = new Set<string>();
  const hints: string[] = [];
  for (let offset = 0; seen.size < 100; offset += 200) {
    const rows = await db.select({ title: history.title, attendeeEmails: history.attendeeEmails }).from(history)
      .orderBy(desc(history.time), desc(history.id)).limit(200).offset(offset);
    hints.push(...collectRecentCompanyHints(rows, seen));
    if (rows.length < 200) break;
  }
  return hints;
}
