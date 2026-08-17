import { describe, expect, it } from "vitest";

import {
  getAudioPlaylistDurationSeconds,
  getAudioPlaylistPartOffsetSeconds,
  getAudioPlaylistPosition,
} from "@/lib/audio-playlist";

const parts = [
  { audioUrl: "/one", durationMs: 30_000, id: "one" },
  { audioUrl: "/two", durationMs: 45_000, id: "two" },
];

describe("audio playlist", () => {
  it("maps one global timeline onto ordered recording files", () => {
    expect(getAudioPlaylistDurationSeconds(parts)).toBe(75);
    expect(getAudioPlaylistPartOffsetSeconds(parts, 1)).toBe(30);
    expect(getAudioPlaylistPosition(parts, 29)).toMatchObject({
      localTimeSeconds: 29,
      partIndex: 0,
    });
    expect(getAudioPlaylistPosition(parts, 30)).toMatchObject({
      globalTimeSeconds: 30,
      localTimeSeconds: 0,
      partIndex: 1,
      partOffsetSeconds: 30,
    });
    expect(getAudioPlaylistPosition(parts, 80)).toMatchObject({
      globalTimeSeconds: 75,
      localTimeSeconds: 45,
      partIndex: 1,
    });
  });

  it("keeps a single recording compatible when its duration is unknown", () => {
    expect(
      getAudioPlaylistPosition(
        [{ audioUrl: "/one", durationMs: null, id: "one" }],
        12,
      ),
    ).toMatchObject({ localTimeSeconds: 12, partIndex: 0 });
  });

  it("uses wall clock spacing when a legacy part duration is missing", () => {
    const legacyParts = [
      {
        audioUrl: "/one.mp3",
        durationMs: null,
        id: "one",
        startedAt: "2026-08-16T14:00:00.000Z",
      },
      {
        audioUrl: "/two.mp3",
        durationMs: 30_000,
        id: "two",
        startedAt: "2026-08-16T14:05:00.000Z",
      },
    ];

    expect(getAudioPlaylistPartOffsetSeconds(legacyParts, 1)).toBe(300);
    expect(getAudioPlaylistPosition(legacyParts, 305)).toMatchObject({
      localTimeSeconds: 5,
      partIndex: 1,
    });
  });
});
