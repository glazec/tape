import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets, meetings } from "@/db/schema";
import {
  buildScreenShareIntervals,
  parseRecallParticipantEvents,
} from "@/lib/recall-screen-share";
import {
  assertSafeObjectKeySegment,
  buildMeetingObjectKey,
  parseR2Env,
  putObject,
} from "@/lib/r2";
import {
  findRecallVideoFrameArtifacts,
  retrieveRecallBot,
} from "@/lib/vendors/recall";
import { analyzeStableVisualFrames } from "@/lib/video-frame-detection";
import {
  extractJpegFrame,
  probeVideoDurationMs,
  sampleScreenShareFrames,
} from "@/lib/video-frame-ffmpeg";

const MAX_PARTICIPANT_EVENTS_BYTES = 10 * 1024 * 1024;
const PARTICIPANT_EVENTS_TIMEOUT_MS = 30_000;

class ParticipantEventsTooLargeError extends Error {
  constructor() {
    super("Recall participant events response is too large");
    this.name = "ParticipantEventsTooLargeError";
  }
}

export async function persistRecallMeetingVideoFrames(input: {
  meetingId: string;
  recallBotId: string;
  recallRecordingId: string;
}): Promise<{
  duplicateCount: number;
  frameCount: number;
  intervalCount: number;
}> {
  assertSafeObjectKeySegment(
    input.recallRecordingId,
    "recallRecordingId",
  );

  const [meeting] = await db
    .select({ teamId: meetings.teamId })
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);

  if (!meeting) {
    throw new Error("Meeting not found");
  }

  const bot = await retrieveRecallBot(input.recallBotId);
  const artifacts = findRecallVideoFrameArtifacts(
    bot,
    input.recallRecordingId,
  );

  if (!artifacts) {
    throw new Error("Recall video frame artifacts are unavailable");
  }

  const durationMs = await probeVideoDurationMs(artifacts.videoUrl);
  const rawEvents = await fetchParticipantEvents(
    artifacts.participantEventsUrl,
  );
  const events = parseRecallParticipantEvents(rawEvents);
  const intervals = buildScreenShareIntervals({ durationMs, events });

  if (intervals.length === 0) {
    return { duplicateCount: 0, frameCount: 0, intervalCount: 0 };
  }

  const frames = await sampleScreenShareFrames({
    intervals,
    videoUrl: artifacts.videoUrl,
  });
  const analysis = analyzeStableVisualFrames(frames);
  const timestamps = [
    ...new Set(
      analysis.timestamps.map((timestampMs) => Math.round(timestampMs)),
    ),
  ];

  if (timestamps.length === 0) {
    return {
      duplicateCount: analysis.duplicateCount,
      frameCount: 0,
      intervalCount: intervals.length,
    };
  }

  const env = parseR2Env(process.env);
  const existingAssets = await db
    .select({ objectKey: mediaAssets.objectKey })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.meetingId, input.meetingId),
        eq(mediaAssets.source, "recall"),
        eq(mediaAssets.type, "video_frame"),
        eq(mediaAssets.bucket, env.R2_BUCKET),
      ),
    );
  const existingObjectKeys = new Set(
    existingAssets.map((asset) => asset.objectKey),
  );
  const recordingStartedAtMs = new Date(
    artifacts.recordingStartedAt,
  ).getTime();

  for (const timestampMs of timestamps) {
    const objectKey = buildMeetingObjectKey({
      teamId: meeting.teamId,
      meetingId: input.meetingId,
      assetId: `recall-${input.recallRecordingId}-screen-share-v1-${timestampMs}`,
      extension: "jpg",
    });

    if (existingObjectKeys.has(objectKey)) {
      continue;
    }

    const jpeg = await extractJpegFrame({
      timestampMs,
      videoUrl: artifacts.videoUrl,
    });
    const checksum = createHash("sha256").update(jpeg).digest("hex");

    await putObject({
      key: objectKey,
      body: jpeg,
      contentType: "image/jpeg",
    });

    await db
      .insert(mediaAssets)
      .values({
        meetingId: input.meetingId,
        source: "recall",
        type: "video_frame",
        bucket: env.R2_BUCKET,
        objectKey,
        mimeType: "image/jpeg",
        fileSizeBytes: jpeg.length,
        checksum,
        timestampMs,
        capturedAt: new Date(recordingStartedAtMs + timestampMs),
      })
      .onConflictDoNothing({
        target: [mediaAssets.bucket, mediaAssets.objectKey],
      });
  }

  return {
    duplicateCount: analysis.duplicateCount,
    frameCount: timestamps.length,
    intervalCount: intervals.length,
  };
}

async function fetchParticipantEvents(urlValue: string): Promise<unknown> {
  const url = parseParticipantEventsUrl(urlValue);
  let response: Response;

  try {
    response = await fetch(url.href, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(PARTICIPANT_EVENTS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Unable to fetch Recall participant events");
  }

  if (!response.ok) {
    throw new Error("Recall participant events request failed");
  }

  const declaredLength = response.headers.get("content-length");

  if (
    declaredLength !== null &&
    Number(declaredLength) > MAX_PARTICIPANT_EVENTS_BYTES
  ) {
    throw new ParticipantEventsTooLargeError();
  }

  let body: Uint8Array;

  try {
    body = await readLimitedBody(
      response,
      MAX_PARTICIPANT_EVENTS_BYTES,
    );
  } catch (error) {
    if (error instanceof ParticipantEventsTooLargeError) {
      throw error;
    }

    throw new Error("Unable to read Recall participant events");
  }

  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("Recall participant events response was not valid JSON");
  }
}

function parseParticipantEventsUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Recall participant events URL is unsafe");
  }

  const trustedHostname =
    url.hostname === "recall.ai" || url.hostname.endsWith(".recall.ai");

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    !trustedHostname
  ) {
    throw new Error("Recall participant events URL is unsafe");
  }

  return url;
}

async function readLimitedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    byteLength += value.length;

    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ParticipantEventsTooLargeError();
    }

    chunks.push(value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return body;
}
