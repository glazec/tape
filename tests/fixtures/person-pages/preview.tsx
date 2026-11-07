import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { PersonPageView } from "@/components/person-page-view";
import { TranscriptViewer, type TranscriptSegment } from "@/components/transcript-viewer";
import type { PersonPageData } from "@/lib/people";
import { summarizeColleagues } from "@/lib/person-relationship";
import type { StoredPersonProfile } from "@/lib/person-profile";

// Fictional records for visual review only.
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const meeting = (id: string, title: string, days: number, spoke = true, talkMs = 240_000, colleagues = ["Jordan Park"], canOpen = true) => ({
  id, title, at: daysAgo(days), ownerName: colleagues[0], colleagues, canOpen, spoke, talkMs: spoke ? talkMs : 0,
  totalMs: spoke ? 1_800_000 : 0, durationMs: spoke ? 1_800_000 + talkMs : 1_500_000,
});
const data: PersonPageData = {
  canMerge: true,
  person: { id: "dana", name: "Dana Whitfield", emails: ["dana@lumenrobotics.test", "dana.w@gmail.test"], names: ["Dana W"], isTeammate: false },
  meetings: [
    meeting("next", "Lumen Robotics partner sync", -6, false, 0, ["Jordan Park", "Yiping Lu"]),
    meeting("m1", "Lumen Robotics seed follow up", 4, true, 410_000, ["Jordan Park", "Yiping Lu"]),
    meeting("m6", "Lumen Robotics pricing review", 9, true, 900_000, ["Riley Ng"], false),
    meeting("m2", "Robotics data partnerships", 19, true, 240_000, ["Jordan Park"]),
    meeting("m3", "Lumen Robotics diligence call", 41, true, 520_000, ["Jordan Park", "Riley Ng", "Yiping Lu"]),
    meeting("m7", "Warehouse pilot check in", 48, true, 600_000, ["Riley Ng"]),
    meeting("m4", "Founder dinner debrief", 75, false, 0, ["Yiping Lu"]),
    meeting("m8", "Lumen Robotics market map", 130, true, 300_000, ["Jordan Park"]),
    meeting("m5", "Intro: Lumen Robotics", 210, true, 300_000, ["Riley Ng", "Jordan Park"]),
  ],
  todos: [
    { kind: "todo", text: "Dana Whitfield will send the fleet utilization data room to Jordan.", timing: "by Friday", meetingId: "m1", meetingTitle: "Lumen Robotics seed follow up", meetingAt: daysAgo(4), segmentId: "s1", todoKey: "s1000000000000000000000000000000" },
    { kind: "todo", text: "Dana Whitfield will introduce Jordan to the warehouse pilot customer.", timing: null, meetingId: "m3", meetingTitle: "Lumen Robotics diligence call", meetingAt: daysAgo(41), segmentId: "s2", todoKey: "s2000000000000000000000000000000", state: { status: "done", updatedBy: "Riley Ng", updatedAt: daysAgo(30) } },
    { kind: "todo", text: "Dana Whitfield will share pilot pricing for two warehouses.", timing: "next week", meetingId: "m6", meetingTitle: "Lumen Robotics pricing review", meetingAt: daysAgo(9), segmentId: "s6", todoKey: "s6000000000000000000000000000000", state: { status: "in_progress", updatedBy: "Jordan Park", updatedAt: daysAgo(3) } },
  ],
  dynamics: [
    { kind: "dynamic", text: "Dana Whitfield seeks investors with logistics customer networks.", timing: null, meetingId: "m1", meetingTitle: "Lumen Robotics seed follow up", meetingAt: daysAgo(4), segmentId: "s3", todoKey: "s3000000000000000000000000000000" },
  ],
  connections: [
    { kind: "person", name: "Priya Raman", company: "Northline Logistics", title: null, relationship: "In discussion", context: "Pilot customer evaluating 40 robots for two warehouses.", meetingId: "m3", meetingTitle: "Lumen Robotics diligence call", meetingAt: daysAgo(41), segmentId: "s4" },
    { kind: "team", name: null, company: "Former employer", title: null, relationship: "Works with", context: "Perception research team that shares simulation tooling.", meetingId: "m5", meetingTitle: "Intro: Lumen Robotics", meetingAt: daysAgo(210), segmentId: "s5" },
  ],
  colleagues: [],
  viewerName: "Yiping Lu",
  truncated: false,
};
data.colleagues = summarizeColleagues(data.meetings);
const profile: StoredPersonProfile = {
  generatedAt: daysAgo(2),
  sourceMeetings: [{ id: "m5", title: "Intro", at: daysAgo(210) }, { id: "m1", title: "Seed follow up", at: daysAgo(4) }],
  profile: {
    version: 1,
    headline: "Cofounder and CEO of Lumen Robotics, building warehouse picking robots",
    role: [{ text: "Leads Lumen Robotics and owns fundraising and the first enterprise pilots.", sources: ["s1"] }],
    recentFocus: [
      { text: "Raising a seed round and lining up investors with logistics networks.", sources: ["s3"] },
      { text: "Converting the Northline pilot into a paid deployment this quarter.", sources: ["s4"] },
    ],
    background: [{ text: "Says they spent six years on perception research before founding the company.", sources: ["s5"] }],
    achievements: [{ text: "Reports a 40 robot pilot under evaluation at a logistics customer.", sources: ["s4"] }],
    expertise: {
      technical: { level: "strong", summary: "Explains perception and grasp planning tradeoffs in depth.", sources: ["s5"] },
      operational: { level: "working", summary: "Describes pilot rollout steps but few scaling details.", sources: ["s2"] },
      business: { level: "working", summary: "Frames pricing as robots as a service per site.", sources: ["s1"] },
      social: { level: "unclear", summary: "Not enough evidence in these meetings.", sources: [] },
    },
    sources: {
      s1: { meetingId: "m1", startMs: 312_000 }, s2: { meetingId: "m3", startMs: 1_260_000 }, s3: { meetingId: "m1", startMs: 95_000 },
      s4: { meetingId: "m3", startMs: 640_000 }, s5: { meetingId: "m5", startMs: 48_000 },
    },
  },
};
const mergeCandidates = [
  { id: "d2", name: "Dana W.", emails: ["dana.whitfield@lumen.test"], meetingCount: 2, likely: true },
  { id: "d3", name: "dana", emails: [], meetingCount: 1, likely: true },
  { id: "x1", name: "Marcus Hale", emails: ["marcus@northline.test"], meetingCount: 5, likely: false },
];
const segments: TranscriptSegment[] = [
  { id: "a", meetingSpeakerId: "g-a", speakerRevision: 0, personId: "dana", sourceSpeaker: "Speaker 1", speaker: "Dana Whitfield", text: "We are raising a seed round this quarter.", startMs: 0, endMs: 12000 },
  { id: "b", meetingSpeakerId: "g-b", speakerRevision: 0, personId: null, sourceSpeaker: "Speaker 2", speaker: "Jordan Park", text: "Who else is in the round?", startMs: 12000, endMs: 18000 },
  { id: "c", meetingSpeakerId: "g-c", speakerRevision: 0, personId: null, sourceSpeaker: "Speaker 3", speaker: "Speaker 3", text: "Sorry, joining late.", startMs: 18000, endMs: 20000 },
];

const params = new URLSearchParams(location.search);
const mode = params.get("profile");
window.fetch = async (input, init) => {
  const url = String(input);
  await new Promise(resolve => setTimeout(resolve, mode === "slow" ? 2500 : 300));
  if (url.endsWith("/profile")) {
    if (mode === "error") return Response.json({ error: "Could not write the profile. Try again." }, { status: 502 });
    if (mode === "empty") return Response.json({ status: "no_meetings" });
    return Response.json({ status: "ready", profile });
  }
  if (url.endsWith("/merge") && init?.method === "POST") return Response.json({ personId: "dana" });
  if (url.endsWith("/merge")) return Response.json({ people: mergeCandidates });
  if (url.endsWith("/people")) return Response.json({ personId: "new-person" });
  if (url.endsWith("/todos")) return Response.json({ ...JSON.parse(String(init?.body)), updatedBy: "Yiping Lu", updatedAt: new Date().toISOString() });
  return Response.json({});
};

function App() {
  const [navigated, setNavigated] = useState<string | null>(null);
  useEffect(() => {
    const listener = (event: Event) => setNavigated((event as CustomEvent<string>).detail);
    window.addEventListener("fixture-navigate", listener);
    return () => window.removeEventListener("fixture-navigate", listener);
  }, []);
  const view = params.get("view");
  return (
    <main className="mx-auto w-full max-w-5xl bg-background px-4 py-8 text-foreground sm:px-8">
      {navigated ? <p className="mb-4 text-xs text-muted-foreground" data-testid="navigated">Navigated to {navigated}</p> : null}
      {view === "transcript" ? (
        <TranscriptViewer canOpenPeople meetingId="fixture" segments={segments} />
      ) : (
        <PersonPageView data={params.get("empty") ? { ...data, meetings: [], todos: [], dynamics: [], connections: [], colleagues: [] } : data} profile={mode ? null : profile} />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
