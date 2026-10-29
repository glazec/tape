import { createHash } from "node:crypto";
import { z } from "zod";

import {
  FOLLOWUP_PROMPT_VERSION,
  type FollowupSource,
  meetingFollowupSchema,
  parseMeetingFollowup,
} from "@/lib/meeting-followup";

type FollowupMeeting = FollowupSource & { followupSource?: FollowupSource };

export function getFollowupSource(meeting: FollowupMeeting): FollowupSource {
  // Display titles and team aliases may differ for a shared reader.
  const source = meeting.followupSource ?? meeting;
  return {
    title: source.title,
    startedAt: source.startedAt,
    segments: source.segments.map(({ id, speaker, startMs, text }) => ({
      id,
      speaker,
      startMs,
      text,
    })),
  };
}

export function getFollowupSourceHash(meeting: FollowupMeeting) {
  return hashSource(meeting, FOLLOWUP_PROMPT_VERSION);
}

function hashSource(meeting: FollowupMeeting, version: number) {
  return createHash("sha256")
    .update(
      JSON.stringify([version, getFollowupSource(meeting)]),
    )
    .digest("hex");
}

const storedFollowupSchema = z.strictObject({
  sourceHash: z.string(),
  result: z.union([meetingFollowupSchema, meetingFollowupSchema.omit({ research: true })]),
});

export function getCurrentMeetingFollowup(
  meeting: FollowupMeeting & {
    aiFollowup?: unknown;
    status: string;
    transcriptJobStatus: string | null;
  },
) {
  if (!isFollowupReady(meeting)) return null;
  const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
  if (!saved.success) return null;
  // Keep existing summaries visible until a manager chooses to regenerate.
  const legacy = !("research" in saved.data.result);
  if (saved.data.sourceHash !== hashSource(meeting, legacy ? 1 : FOLLOWUP_PROMPT_VERSION)) {
    return null;
  }
  try {
    return parseMeetingFollowup(
      JSON.stringify({ research: [], ...saved.data.result }),
      getFollowupSource(meeting),
    );
  } catch {
    return null;
  }
}

export function isFollowupReady(
  meeting: FollowupSource & {
    status: string;
    transcriptJobStatus: string | null;
  },
) {
  return (
    meeting.status === "ready" &&
    meeting.segments.length > 0 &&
    (meeting.transcriptJobStatus === null ||
      meeting.transcriptJobStatus === "completed")
  );
}
