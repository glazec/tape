import { describe, expect, it } from "vitest";

import { buildMeetingObjectKey, buildPendingUploadObjectKey } from "@/lib/r2";

describe("buildMeetingObjectKey", () => {
  it("builds the R2 object key for a meeting asset", () => {
    expect(
      buildMeetingObjectKey({
        teamId: "team_123",
        meetingId: "meeting_456",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toBe("teams/team_123/meetings/meeting_456/assets/asset_789.mp3");
  });

  it("rejects traversal shaped segments", () => {
    expect(() =>
      buildMeetingObjectKey({
        teamId: "../other",
        meetingId: "meeting_456",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });

  it("rejects slash separated segments", () => {
    expect(() =>
      buildMeetingObjectKey({
        teamId: "team_123",
        meetingId: "a/b",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });
});

describe("buildPendingUploadObjectKey", () => {
  it("builds the R2 object key for a user scoped pending upload", () => {
    expect(
      buildPendingUploadObjectKey({
        userId: "user_123",
        uploadId: "upload_456",
        extension: "mp3",
      }),
    ).toBe("users/user_123/uploads/upload_456.mp3");
  });

  it("rejects unsafe user id segments", () => {
    expect(() =>
      buildPendingUploadObjectKey({
        userId: "user/123",
        uploadId: "upload_456",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });

  it("rejects unsafe upload id segments", () => {
    expect(() =>
      buildPendingUploadObjectKey({
        userId: "user_123",
        uploadId: "../upload",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });
});
