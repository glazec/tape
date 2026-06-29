import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets, meetings } from "@/db/schema";
import {
  buildMeetingObjectKey,
  parseR2Env,
  putObject,
} from "@/lib/r2";
import { listRecallBotScreenshots } from "@/lib/vendors/recall";

const MAX_RECALL_SCREENSHOTS_PER_MEETING = 40;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export async function persistRecallBotScreenshots(input: {
  botId: string;
  meetingId: string;
}) {
  const [meeting] = await db
    .select({
      startedAt: meetings.startedAt,
      teamId: meetings.teamId,
    })
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);

  if (!meeting) {
    return { count: 0 };
  }

  const env = parseR2Env(process.env);
  const screenshots = await listRecallBotScreenshots(input.botId);
  const storedScreenshotIds = new Set<string>();
  let count = 0;

  for (const screenshot of screenshots.slice(0, MAX_RECALL_SCREENSHOTS_PER_MEETING)) {
    const response = await fetch(screenshot.downloadUrl);

    if (!response.ok) {
      continue;
    }

    const contentType = normalizeImageContentType(
      response.headers.get("content-type"),
    );

    if (!contentType) {
      continue;
    }

    const body = new Uint8Array(await response.arrayBuffer());

    if (body.length === 0 || body.length > MAX_SCREENSHOT_BYTES) {
      continue;
    }

    const capturedAt = parseCapturedAt(screenshot.capturedAt);
    const stableScreenshotId = getStableScreenshotId(screenshot);

    if (storedScreenshotIds.has(stableScreenshotId)) {
      continue;
    }

    storedScreenshotIds.add(stableScreenshotId);

    const objectKey = buildMeetingObjectKey({
      teamId: meeting.teamId,
      meetingId: input.meetingId,
      assetId: `recall-${stableScreenshotId}`,
      extension: getImageExtension(contentType),
    });

    await putObject({
      key: objectKey,
      body,
      contentType,
    });

    await db
      .insert(mediaAssets)
      .values({
        meetingId: input.meetingId,
        source: "recall",
        type: "screenshot",
        bucket: env.R2_BUCKET,
        objectKey,
        mimeType: contentType,
        fileSizeBytes: body.length,
        capturedAt,
        timestampMs: getRelativeTimestampMs(capturedAt, meeting.startedAt),
      })
      .onConflictDoNothing({
        target: [mediaAssets.bucket, mediaAssets.objectKey],
      });
    count += 1;
  }

  return { count };
}

function getStableScreenshotId(input: {
  capturedAt: string | null;
  id: string;
}) {
  return createHash("sha256")
    .update([input.id, input.capturedAt ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function parseCapturedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const capturedAt = new Date(value);

  return Number.isNaN(capturedAt.getTime()) ? null : capturedAt;
}

function getRelativeTimestampMs(capturedAt: Date | null, startedAt: Date | null) {
  if (!capturedAt || !startedAt) {
    return null;
  }

  return Math.max(0, capturedAt.getTime() - startedAt.getTime());
}

function normalizeImageContentType(value: string | null) {
  const contentType = value?.split(";")[0]?.trim().toLowerCase();

  if (
    contentType === "image/jpeg" ||
    contentType === "image/png" ||
    contentType === "image/gif" ||
    contentType === "image/webp"
  ) {
    return contentType;
  }

  return null;
}

function getImageExtension(contentType: string) {
  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/gif") {
    return "gif";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  return "jpg";
}
