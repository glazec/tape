import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  initializeDatabaseClaimsContext,
  setDatabaseSessionUser,
} from "@/db/rls-context";
import type { SessionUser } from "@/lib/auth";

const MCP_REQUEST_TOLERANCE_SECONDS = 5 * 60;

const mcpBackendEnvelopeSchema = z.strictObject({
  input: z.unknown(),
  user: z.strictObject({
    email: z.email(),
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(200).nullable(),
  }),
});

export class McpBackendAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 500,
  ) {
    super(message);
    this.name = "McpBackendAuthError";
  }
}

export function getMcpBackendSharedSecret() {
  const secret = process.env.MCP_BACKEND_SHARED_SECRET?.trim();

  if (!secret || secret.length < 32) {
    throw new McpBackendAuthError(
      "MCP backend authentication is not configured",
      500,
    );
  }

  return secret;
}

export function verifyMcpBackendRequest(rawBody: string, headers: Headers): {
  input: unknown;
  user: SessionUser;
} {
  const requestId = headers.get("x-tape-mcp-id");
  const timestamp = headers.get("x-tape-mcp-timestamp");
  const signature = headers.get("x-tape-mcp-signature");
  const timestampSeconds = Number(timestamp);

  if (
    !requestId ||
    !timestamp ||
    !signature ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
      MCP_REQUEST_TOLERANCE_SECONDS
  ) {
    throw new McpBackendAuthError("Invalid MCP backend signature", 401);
  }

  const expected = createHmac("sha256", getMcpBackendSharedSecret())
    .update(`${requestId}.${timestamp}.${rawBody}`)
    .digest("base64url");
  const expectedBytes = Buffer.from(expected);
  const valid = signature.split(" ").some((versionedSignature) => {
    const [version, value] = versionedSignature.split(",");

    if (version !== "v1" || !value) {
      return false;
    }

    const providedBytes = Buffer.from(value);
    return (
      providedBytes.length === expectedBytes.length &&
      timingSafeEqual(providedBytes, expectedBytes)
    );
  });

  if (!valid) {
    throw new McpBackendAuthError("Invalid MCP backend signature", 401);
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody || "null");
  } catch {
    throw new McpBackendAuthError("Invalid MCP backend request", 401);
  }

  const envelope = mcpBackendEnvelopeSchema.safeParse(body);

  if (!envelope.success) {
    throw new McpBackendAuthError("Invalid MCP backend request", 401);
  }

  const user = {
    id: envelope.data.user.id,
    email: envelope.data.user.email.trim().toLowerCase(),
    name: envelope.data.user.name,
  } satisfies SessionUser;

  initializeDatabaseClaimsContext();
  setDatabaseSessionUser(user);

  return { input: envelope.data.input, user };
}

export function mcpBackendAuthErrorResponse(error: unknown) {
  if (error instanceof McpBackendAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return null;
}
