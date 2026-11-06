import React from "react";
import { createRoot } from "react-dom/client";
import { TranscriptViewer, type TranscriptSegment } from "@/components/transcript-viewer";
const segments: TranscriptSegment[] = [
  { id: "a", meetingSpeakerId: "group-a", speakerRevision: 0, personId: null, sourceSpeaker: "Speaker 1", speaker: "Alex", text: "Our team can share the deployment results tomorrow.", startMs: 0, endMs: 10000 },
  { id: "b", meetingSpeakerId: "group-b", speakerRevision: 0, personId: "other", sourceSpeaker: "Speaker 2", speaker: "Alex", text: "I will review the capacity plan with Maya.", startMs: 10000, endMs: 20000 },
];
const people = [{ id: "alex", name: "Alex Quinn", emails: ["alex@example.test"], inMeeting: true }, { id: "maya", name: "Maya", emails: [], inMeeting: false }];
window.fetch = async (_input, init) => {
  if (init?.method !== "PATCH") return Response.json({ people, participants: [{ name: "Taylor", email: "taylor@example.test" }] });
  const body = JSON.parse(String(init.body));
  const person = people.find(person => person.id === body.personId);
  return Response.json({ updated: true, segments: segments.filter(segment => body.applyTo === "segment" ? segment.id === body.segmentId : segment.meetingSpeakerId === body.meetingSpeakerId).map(segment => ({ ...segment, speaker: body.speaker, personId: body.linkAction === "unlink" ? null : person?.id ?? segment.personId ?? "new", participantEmail: person?.emails[0] ?? body.participantEmail, speakerRevision: 1 })) });
};
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-3xl bg-background px-5 py-8 text-foreground"><h1 className="mb-8 text-xl font-semibold">Speaker identity review</h1><TranscriptViewer meetingId="fixture" segments={segments} /></main>);
