import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MeetingNotes } from "@/components/meeting-notes";
import { MeetingActions } from "@/components/meeting-actions";
import { MeetingRecordingResume } from "@/components/meeting-recording-resume";
import { MeetingComposedTranscripts } from "@/components/meeting-composed-transcripts";
import type { MeetingTranscript } from "@/lib/meeting-queries";

const original: MeetingTranscript = {
  id: "original",
  title: "Product conversation",
  platform: "zoom",
  meetingUrl: "https://zoom.us/j/123",
  status: "ready",
  startedAt: new Date(Date.now() - 45 * 60000).toISOString(),
  endedAt: new Date(Date.now() - 15 * 60000).toISOString(),
  updatedAt: new Date().toISOString(),
  durationMs: 1800000,
  transcriptJobStatus: "completed",
  translationLanguage: "en",
  translationSummary: {
    hasTranslations: false,
    status: "not_started",
    totalSegments: 2,
    translatedSegments: 0,
  },
  audioUrl: null,
  recordingParts: [],
  scheduledStartedAt: null,
  scheduledEndedAt: null,
  visualAssets: [],
  speakerAliases: [],
  speakerSuggestions: [{ name: "Yiping", email: "yiping@iosf.vc" }],
  accessScope: "workspace",
  canManage: true,
  canDelete: true,
  accessPeople: [],
  entities: [],
  segments: [
    {
      id: "line-one",
      speaker: "yiping@iosf.vc",
      startMs: 0,
      endMs: 12000,
      text: "Let's make it easy to pick up the conversation when a meeting ends early.",
    },
    {
      id: "line-two",
      speaker: "Jamie",
      startMs: 12000,
      endMs: 24000,
      text: "The earlier notes should stay in one place, with each recording clearly separated.",
    },
  ],
};
const next = {
  ...original,
  id: "next",
  title: "Product conversation · next recording",
  startedAt: new Date(Date.now() - 10 * 60000).toISOString(),
  endedAt: new Date().toISOString(),
  status: "processing",
  transcriptJobStatus: "queued",
  segments: [],
} as MeetingTranscript;
const candidates: MeetingTranscript[] = [
  next,
  { ...next, id: "weekly", title: "Weekly product review", status: "ready" },
];
let sourceIds: string[] = [];
let note = {
  content:
    "Focus on the onboarding experience.\nFollow up on the pilot timeline.",
  version: 1,
};
const listeners = new Set<() => void>();
window.addEventListener("fixture-refresh", () =>
  listeners.forEach((listener) => listener()),
);
window.fetch = async (input, options) => {
  const url = String(input);
  if (url.endsWith("/notes")) {
    if (options?.method === "PUT")
      note = { ...JSON.parse(String(options.body)), version: note.version + 1 };
    return Response.json(note);
  }
  if (url.includes("/merge")) {
    if (options?.method === "POST" || options?.method === "DELETE") {
      const { sourceMeetingId } = JSON.parse(String(options.body));
      sourceIds =
        options.method === "POST"
          ? [...sourceIds, sourceMeetingId]
          : sourceIds.filter((id) => id !== sourceMeetingId);
      return Response.json({ updated: true });
    }
    const query =
      new URL(url, location.href).searchParams.get("query")?.toLowerCase() ??
      "";
    return Response.json({
      candidates: candidates.filter(
        (candidate) =>
          !sourceIds.includes(candidate.id) &&
          candidate.title.toLowerCase().includes(query),
      ),
      merged: candidates.filter((candidate) =>
        sourceIds.includes(candidate.id),
      ),
    });
  }
  if (url.includes("/continue")) return Response.json({ status: "joining" });
  if (url.includes("/speakers")) return Response.json({ updated: true });
  return Response.json({});
};

function Preview() {
  const [, update] = useState(0);
  React.useEffect(() => {
    const listener = () => update((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <p className="mb-8 text-xs text-muted-foreground">
        Local component preview · Example data
      </p>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-3 text-sm text-muted-foreground">Meetings</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Product conversation
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Today · Zoom · Yiping, Jamie
          </p>
        </div>
        <MeetingActions
          meetingId="original"
          meetingTitle="Product conversation"
          canMerge
          canReplaceAudio
          hasAudio={false}
          hasTranscript={false}
        />
      </header>
      <MeetingNotes meetingId="original" userId="fixture-user" />
      <MeetingRecordingResume
        meetingId="original"
        meetingUrl={original.meetingUrl!}
        lastRecordingEndedAt={original.endedAt!}
      />
      <MeetingComposedTranscripts
        primaryMeetingId="original"
        meetings={[
          original,
          ...candidates.filter((candidate) => sourceIds.includes(candidate.id)),
        ]}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
