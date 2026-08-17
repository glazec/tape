import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  McpBackendAuthError,
  verifyMcpBackendRequest,
} from "@/lib/mcp-backend-auth";
import {
  createMcpUploadToken,
  McpUploadTokenError,
  parseMcpUploadToken,
} from "@/lib/mcp-upload-token";

const sharedSecret = "mcp-backend-test-secret-that-is-long-enough";

function signedHeaders(rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const requestId = "request-123";
  const signature = createHmac("sha256", sharedSecret)
    .update(`${requestId}.${timestamp}.${rawBody}`)
    .digest("base64url");

  return new Headers({
    "x-tape-mcp-id": requestId,
    "x-tape-mcp-signature": `v1,${signature}`,
    "x-tape-mcp-timestamp": String(timestamp),
  });
}

describe("MCP backend authentication", () => {
  beforeEach(() => {
    process.env.MCP_BACKEND_SHARED_SECRET = sharedSecret;
  });

  afterEach(() => {
    delete process.env.MCP_BACKEND_SHARED_SECRET;
  });

  it("accepts a current signed request and normalizes the caller email", () => {
    const rawBody = JSON.stringify({
      input: { fileName: "meeting.mp3" },
      user: {
        email: "Member@Example.com",
        id: "auth-user-123",
        name: "Member",
      },
    });

    const result = verifyMcpBackendRequest(rawBody, signedHeaders(rawBody));

    expect(result).toEqual({
      input: { fileName: "meeting.mp3" },
      user: {
        email: "member@example.com",
        id: "auth-user-123",
        name: "Member",
      },
    });
  });

  it("rejects stale or body mismatched signatures", () => {
    const rawBody = JSON.stringify({
      input: {},
      user: { email: "member@example.com", id: "auth-user-123", name: null },
    });

    expect(() =>
      verifyMcpBackendRequest(
        rawBody,
        signedHeaders(rawBody, Math.floor(Date.now() / 1000) - 301),
      ),
    ).toThrow(McpBackendAuthError);
    expect(() =>
      verifyMcpBackendRequest(`${rawBody} `, signedHeaders(rawBody)),
    ).toThrow(McpBackendAuthError);
  });

  it("rejects production use without a strong shared secret", () => {
    process.env.MCP_BACKEND_SHARED_SECRET = "short";
    const rawBody = JSON.stringify({
      input: {},
      user: { email: "member@example.com", id: "auth-user-123", name: null },
    });

    expect(() =>
      verifyMcpBackendRequest(rawBody, signedHeaders(rawBody)),
    ).toThrow("MCP backend authentication is not configured");
  });
});

describe("MCP meeting upload token", () => {
  beforeEach(() => {
    process.env.MCP_BACKEND_SHARED_SECRET = sharedSecret;
  });

  afterEach(() => {
    delete process.env.MCP_BACKEND_SHARED_SECRET;
  });

  it("round trips bound upload metadata", () => {
    const payload = {
      authUserId: "auth-user-123",
      contentType: "audio/mpeg",
      durationMs: 60_000,
      expiresAt: Math.floor(Date.now() / 1000) + 900,
      extension: "mp3",
      fileName: "meeting.mp3",
      fileSizeBytes: 123,
      meetingTime: "2026-08-17T15:00:00.000Z",
      title: "Test meeting",
      uploadId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      version: 1 as const,
    };

    expect(parseMcpUploadToken(createMcpUploadToken(payload))).toEqual(payload);
  });

  it("rejects tampered and expired tokens", () => {
    const token = createMcpUploadToken({
      authUserId: "auth-user-123",
      contentType: "audio/mpeg",
      expiresAt: Math.floor(Date.now() / 1000) - 1,
      extension: "mp3",
      fileName: "meeting.mp3",
      fileSizeBytes: 123,
      meetingTime: "2026-08-17T15:00:00.000Z",
      uploadId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      version: 1,
    });

    expect(() => parseMcpUploadToken(token)).toThrow(McpUploadTokenError);
    expect(() => parseMcpUploadToken(`${token}changed`)).toThrow(
      McpUploadTokenError,
    );
  });
});
