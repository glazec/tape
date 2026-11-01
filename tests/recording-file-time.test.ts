import { describe, expect, it } from "vitest";
import {
  inferRecordingFileTime,
  localTimeToIso,
  timeInZone,
  readRecordingCreationTime,
  parseMediaTimestamp,
} from "@/lib/recording-file-time";

describe("recording time clues", () => {
  const now = new Date("2026-10-31T03:00:00Z");
  it("recognizes the supplied recorder name and labels its missing year", () => {
    expect(
      inferRecordingFileTime(
        { name: "Oct 19 at 11-41 AM.m4a", lastModified: now.getTime() },
        now,
      ),
    ).toEqual({
      localTime: "2026-10-19T11:41",
      source: "filename",
      assumedYear: true,
    });
  });
  it.each([
    ["2026-10-19 14.30.05 Office.m4a", "2026-10-19T14:30:05"],
    ["Recording_20261019_143005.mp3", "2026-10-19T14:30:05"],
    ["Oct 19 at 12-00 AM.m4a", "2026-10-19T00:00"],
    ["Oct 19 at 12-00 PM.m4a", "2026-10-19T12:00"],
  ])("parses %s", (name, localTime) => {
    expect(
      inferRecordingFileTime({ name, lastModified: 0 }, now)?.localTime,
    ).toBe(localTime);
  });
  it("does not invent a date from a location or use invalid calendar dates", () => {
    expect(
      inferRecordingFileTime(
        { name: "Brooklyn office.m4a", lastModified: 0 },
        now,
      ),
    ).toBeNull();
    expect(
      inferRecordingFileTime(
        { name: "2026-02-30 09.30.mp3", lastModified: 0 },
        now,
      ),
    ).toBeNull();
  });
  it("labels modification time as a weak clue and handles year rollover", () => {
    expect(
      inferRecordingFileTime(
        { name: "Office.m4a", lastModified: now.getTime() },
        now,
      )?.source,
    ).toBe("modified");
    expect(
      inferRecordingFileTime(
        { name: "Dec 31 at 11-41 PM.m4a", lastModified: 0 },
        new Date("2026-01-02T10:00Z"),
      )?.localTime,
    ).toBe("2025-12-31T23:41");
  });
  it("converts the chosen timezone, rejecting missing and repeated DST hours", () => {
    expect(localTimeToIso("2026-10-19T11:41", "America/New_York")).toEqual({
      iso: "2026-10-19T15:41:00.000Z",
    });
    expect(
      localTimeToIso("2026-03-08T02:30", "America/New_York").error,
    ).toMatch(/does not exist/);
    expect(
      localTimeToIso("2026-11-01T01:30", "America/New_York").error,
    ).toMatch(/twice/);
    expect(localTimeToIso("2026-11-01T01:30", "UTC-04:00").iso).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(localTimeToIso("2026-02-30T11:41", "UTC").error).toBeTruthy();
    expect(localTimeToIso("2026-10-19T11:41", "wrong").error).toBeTruthy();
  });
  it("formats an instant in the selected zone", () => {
    expect(timeInZone("2026-10-19T20:11:23Z", "America/New_York")).toBe(
      "2026-10-19T16:11:23",
    );
  });
  it.each([
    ["12:34", 754],
    ["1:02:34", 3754],
    ["85:27", 5127],
    ["1:99", null],
    ["-1:00", null],
    ["1:2:3:4", null],
  ])("validates preview timestamp %s", (value, result) => {
    expect(parseMediaTimestamp(String(value))).toBe(result);
  });
  it("reads MP4 creation metadata without mistaking it for a proven start", async () => {
    const data = new Uint8Array(32);
    const view = new DataView(data.buffer);
    view.setUint32(0, 32);
    data.set(new TextEncoder().encode("moov"), 4);
    view.setUint32(8, 24);
    data.set(new TextEncoder().encode("mvhd"), 12);
    view.setUint32(20, Date.parse("2026-10-19T20:11:23Z") / 1000 + 2082844800);
    expect(await readRecordingCreationTime(new Blob([data]))).toBe(
      "2026-10-19T20:11:23.000Z",
    );
    expect(
      await readRecordingCreationTime(new Blob([new Uint8Array(20)])),
    ).toBeNull();
  });
});
