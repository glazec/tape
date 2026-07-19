import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { localRecorderDeviceSessions, teamMemberships } from "@/db/schema";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import { getCurrentUser } from "@/lib/auth";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";

const deviceSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const deviceTokenBytes = 32;

export async function getLocalRecorderWorkspace(
  request: Request,
): Promise<WorkspaceContext | null> {
  const bearerToken = getBearerToken(request);

  if (!bearerToken) {
    return null;
  }

  const tokenHash = await hashLocalRecorderSecret(bearerToken);
  const [session] = await db
    .select({
      role: teamMemberships.role,
      teamId: localRecorderDeviceSessions.teamId,
      userId: localRecorderDeviceSessions.userId,
    })
    .from(localRecorderDeviceSessions)
    .innerJoin(
      teamMemberships,
      and(
        eq(teamMemberships.teamId, localRecorderDeviceSessions.teamId),
        eq(teamMemberships.userId, localRecorderDeviceSessions.userId),
      ),
    )
    .where(
      and(
        eq(localRecorderDeviceSessions.tokenHash, tokenHash),
        gt(localRecorderDeviceSessions.expiresAt, new Date()),
        isNull(localRecorderDeviceSessions.revokedAt),
      ),
    )
    .limit(1);

  return session && session.role !== "external"
    ? {
        canCreateMeetings: true,
        domain: "",
        teamId: session.teamId,
        userId: session.userId,
      }
    : null;
}

export async function getLocalRecorderDeviceRequestContext(request: Request) {
  const workspace = await getLocalRecorderWorkspace(request);

  if (!workspace) {
    return {
      ok: false as const,
      error: "Unauthorized",
      status: 401,
    };
  }

  const deviceId = request.headers.get("x-local-recorder-device-id")?.trim();

  if (!deviceId) {
    return {
      ok: false as const,
      error: "Missing recorder device",
      status: 400,
    };
  }

  return {
    appVersion:
      request.headers.get("x-local-recorder-app-version")?.trim() || null,
    ok: true as const,
    deviceId,
    permissionReadiness: parseLocalRecorderPermissionReadiness(
      request.headers.get("x-local-recorder-permission-readiness"),
    ),
    workspace,
  };
}

function parseLocalRecorderPermissionReadiness(value: string | null) {
  if (!value) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const allowedKeys = [
      "accessibility",
      "microphone",
      "notifications",
      "screenCapture",
      "startAtLogin",
    ];
    const readiness: Record<string, string> = {};

    for (const key of allowedKeys) {
      const state = (parsed as Record<string, unknown>)[key];

      if (state === "granted" || state === "denied" || state === "unknown") {
        readiness[key] = state;
      }
    }

    return readiness;
  } catch {
    return {};
  }
}

export async function createLocalRecorderDeviceSession(input: {
  callbackUrl: string;
  deviceId: string;
  requestUrl: string;
}) {
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Unauthorized" as const };
  }

  const callbackUrl = parseLocalRecorderCallbackUrl(input.callbackUrl);

  if (!callbackUrl) {
    return { error: "Invalid callback" as const };
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  try {
    await assertCanCreateMeetings(workspace);
  } catch (error) {
    if (error instanceof SharedOnlyAccessError) {
      return {
        error: "Shared users cannot add meetings" as const,
        status: 403,
      };
    }

    throw error;
  }

  const token = createDeviceToken();
  const tokenHash = await hashLocalRecorderSecret(token);
  const deviceIdHash = await hashLocalRecorderSecret(input.deviceId);
  const expiresAt = new Date(Date.now() + deviceSessionTtlMs);

  await db.insert(localRecorderDeviceSessions).values({
    deviceIdHash,
    expiresAt,
    teamId: workspace.teamId,
    tokenHash,
    userId: workspace.userId,
  });

  callbackUrl.searchParams.set("token", token);
  callbackUrl.searchParams.set("server", new URL(input.requestUrl).origin);

  return { redirectUrl: callbackUrl.toString() };
}

async function hashLocalRecorderSecret(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Buffer.from(digest).toString("base64url");
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();

  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("bearer ".length).trim();

  return token || null;
}

function createDeviceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(deviceTokenBytes));

  return Buffer.from(bytes).toString("base64url");
}

function parseLocalRecorderCallbackUrl(value: string) {
  try {
    const callbackUrl = new URL(value);

    if (
      callbackUrl.protocol !== "meetingnote-local-recorder:" ||
      callbackUrl.hostname !== "login"
    ) {
      return null;
    }

    callbackUrl.search = "";
    callbackUrl.hash = "";
    return callbackUrl;
  } catch {
    return null;
  }
}
