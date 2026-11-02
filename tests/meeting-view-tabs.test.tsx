// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MeetingViewTabs } from "@/components/meeting-view-tabs";
import { NOTE_MOMENT_NAVIGATE } from "@/lib/note-moments";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function renderTabs(initialView?: "notes" | "transcript") {
  return render(
    <MeetingViewTabs
      initialView={initialView}
      notes={<a href="#line-1">Source 0:29</a>}
      transcript={<div>
        <section><p id="line-1">Hello there</p></section>
        <div className="fixed" data-persistent-player>player</div>
      </div>}
    />,
  );
}

const panel = (view: "notes" | "transcript") =>
  document.querySelector(`[data-view-panel=${view}]`) as HTMLElement;

describe("MeetingViewTabs", () => {
  it("opens on notes and switches to the transcript", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    expect(panel("notes").dataset.state).toBe("active");
    expect(panel("transcript").dataset.state).toBe("inactive");

    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));

    expect(screen.getByRole("tab", { name: "Transcript" }).getAttribute("aria-selected")).toBe("true");
    expect(panel("notes").dataset.state).toBe("inactive");
    expect(window.location.search).toBe("?view=transcript");
  });

  it("keeps the inactive panel laid out so editors can still measure", () => {
    renderTabs("transcript");
    // display:none would collapse auto-sizing textareas to 0px.
    expect(panel("notes").hidden).toBe(false);
    expect(panel("notes").className).toContain("invisible");
    expect(panel("notes").className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("lets a nested player bar stay visible while the transcript is inactive", () => {
    renderTabs();
    expect(panel("transcript").className).toContain("[&_[data-persistent-player]]:visible");
    expect(panel("transcript").querySelector("[data-persistent-player]")?.textContent).toBe("player");
  });

  it("opens the transcript when a source link points into it", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Source 0:29"));
    expect(screen.getByRole("tab", { name: "Transcript" }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens the transcript when a note timestamp navigates", () => {
    renderTabs();
    act(() => {
      window.dispatchEvent(new CustomEvent(NOTE_MOMENT_NAVIGATE, { detail: { meetingId: "m", timestampMs: 0 } }));
    });
    expect(panel("transcript").dataset.state).toBe("active");
  });

  it("ignores a malformed hash instead of throwing", async () => {
    window.history.replaceState(null, "", "/#50%off");
    renderTabs();
    await act(() => new Promise(resolve => setTimeout(resolve, 5)));
    expect(panel("notes").dataset.state).toBe("active");
  });

  it("moves between tabs with the arrow keys", () => {
    renderTabs("transcript");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Transcript" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toBe("");
  });
});
