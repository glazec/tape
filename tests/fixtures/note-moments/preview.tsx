import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { UploadDropzone } from "@/components/upload-dropzone";
import { MeetingNotes } from "@/components/meeting-notes";
import { TranscriptViewer } from "@/components/transcript-viewer";

const targetId = "22222222-2222-4222-8222-222222222222";
const savedKey = "tape-moments-fixture";
const initial = {
  content:
    "[12:34] Confirm the renewal budget before Friday.\n[1:02:34] Ask for the updated rollout plan.",
  version: 1,
  blocks: [
    {
      id: "first",
      text: "[12:34] Confirm the renewal budget before Friday.\n[1:02:34] Ask for the updated rollout plan.",
    },
  ],
};
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/notes")) {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      const next = { ...body, version: body.version + 1 };
      localStorage.setItem(savedKey, JSON.stringify(next));
      return Response.json(next);
    }
    return Response.json(
      JSON.parse(localStorage.getItem(savedKey) ?? JSON.stringify(initial)),
    );
  }
  if (url.startsWith("/api/uploads/meeting-candidates"))
    return Response.json({
      meetings: [
        {
          id: targetId,
          title: "Product review with Maya",
          startedAt: "2026-10-19T15:30:00Z",
          endedAt: "2026-10-19T17:00:00Z",
          unavailableReason: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Weekly planning",
          startedAt: "2026-10-19T16:00:00Z",
          endedAt: "2026-10-19T16:30:00Z",
          unavailableReason: "Already has a recording",
        },
      ],
    });
  if (url === "/api/upload")
    return Response.json({
      uploadId: "11111111-1111-4111-8111-111111111111",
      uploadUrl: "/fixture-upload",
    });
  if (url === "/fixture-upload") return Response.json({});
  if (url === "/api/uploads/complete")
    return Response.json({
      meetingId: targetId,
      redirectTo: `/meetings/${targetId}`,
    });
  return new Response(null, { status: 404 });
};
function Preview() {
  const [tab, setTab] = useState("upload");
  const [live, setLive] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-5 py-4 sm:px-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-xl font-semibold tracking-tight">
            tape<span className="text-primary">.</span>
          </span>
          <span className="text-xs text-muted-foreground">
            Local component preview
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        <nav className="mb-7 flex gap-4 text-sm">
          <button
            className="min-h-11 border-b-2 border-transparent data-[active=true]:border-primary"
            data-active={tab === "upload"}
            onClick={() => setTab("upload")}
          >
            Recording import
          </button>
          <button
            className="min-h-11 border-b-2 border-transparent data-[active=true]:border-primary"
            data-active={tab === "notes"}
            onClick={() => setTab("notes")}
          >
            Meeting notes
          </button>
        </nav>
        {tab === "upload" ? (
          <>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Add a meeting
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Upload a recording
            </h1>
            <p className="mb-7 mt-2 text-sm text-muted-foreground">
              Listen, check the time, and choose where it belongs.
            </p>
            <UploadDropzone />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              Product review with Maya
            </h1>
            <div className="mb-6 mt-2 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Oct 19 · 1 hr 25 min · Maya, Yiping
              </p>
              <button
                className="min-h-11 text-xs underline"
                onClick={() => setLive(!live)}
              >
                {live ? "Finish fixture recording" : "Simulate live recording"}
              </button>
            </div>
            <MeetingNotes
              meetingId={targetId}
              userId="fixture-user"
              momentSources={[
                {
                  id: targetId,
                  durationMs: 5127900,
                  recordings: live
                    ? []
                    : [
                        {
                          startedAt: "2026-10-19T15:41:00Z",
                          endedAt: "2026-10-19T17:06:27.900Z",
                          durationMs: 5127900,
                        },
                      ],
                  hasTranscript: true,
                  recording: live,
                },
              ]}
            />
            <TranscriptViewer
              navigationMeetingId={targetId}
              segments={[
                {
                  id: "first-segment",
                  speaker: "Maya",
                  startMs: 0,
                  endMs: 754000,
                  text: "We are reviewing the rollout plan and the commitments for next quarter.",
                },
                {
                  id: "budget-segment",
                  speaker: "Yiping",
                  startMs: 754000,
                  endMs: 770000,
                  text: "Let’s confirm the renewal budget before Friday. I want to understand the cost per customer before we increase capacity.",
                },
                {
                  id: "rollout-segment",
                  speaker: "Maya",
                  startMs: 3754000,
                  endMs: 3770000,
                  text: "I’ll share the updated rollout plan, including the pilot milestones and the owners for each decision.",
                },
              ]}
            />
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
