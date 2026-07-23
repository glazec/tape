// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MeetingRecordingParts } from "@/components/meeting-recording-parts";

function PartContent({
  audioUrl,
  label,
}: {
  audioUrl?: string | null;
  label: string;
}) {
  return (
    <span>
      {label}:{audioUrl ?? "no audio"}
    </span>
  );
}

describe("MeetingRecordingParts", () => {
  it("switches between resumed recording parts", () => {
    render(
      <MeetingRecordingParts
        parts={[
          {
            audioUrl: "/audio?recording=part-1",
            durationMs: 420_000,
            endedAt: "2026-07-22T17:07:00.000Z",
            id: "part-1",
            startedAt: "2026-07-22T17:00:00.000Z",
          },
          {
            audioUrl: "/audio?recording=part-2",
            durationMs: 900_000,
            endedAt: "2026-07-22T17:35:00.000Z",
            id: "part-2",
            startedAt: "2026-07-22T17:20:00.000Z",
          },
        ]}
      >
        <PartContent label="Transcript for part 1" />
        <PartContent label="Transcript for part 2" />
      </MeetingRecordingParts>,
    );

    expect(screen.getByText("Recording continued in 2 parts")).toBeTruthy();
    expect(
      screen.getByText("Transcript for part 1:/audio?recording=part-1"),
    ).toBeTruthy();
    expect(screen.getByText("Transcript for part 2:no audio")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Part 2" }));

    expect(screen.getByText("Transcript for part 1:no audio")).toBeTruthy();
    expect(
      screen.getByText("Transcript for part 2:/audio?recording=part-2"),
    ).toBeTruthy();
  });
});
