// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));

import { PersonTodos } from "@/components/person-todos";
import type { PersonFollowupItem } from "@/lib/people";

const item = (text: string, extra: Partial<PersonFollowupItem> = {}): PersonFollowupItem => ({
  kind: "todo", text, timing: "by Friday", meetingId: "11111111-1111-4111-8111-111111111111", meetingTitle: "Seed follow up",
  meetingAt: "2026-11-03T15:00:00.000Z", segmentId: "s1", todoKey: text.length.toString(16).padStart(32, "0"), ...extra,
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PersonTodos", () => {
  it("cycles To do, Done and Cancelled, tagging who changed it and keeping the open count live", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => Response.json({ ...JSON.parse(String(init.body)), updatedBy: "Yiping Lu", updatedAt: "2026-11-07T12:00:00.000Z" }));
    vi.stubGlobal("fetch", fetch);
    render(<PersonTodos items={[item("Send the data room.")]} />);
    expect(screen.getByText("1 open")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mark done/ }));
    await waitFor(() => expect(screen.getByText(/Done · Yiping Lu/)).toBeTruthy());
    expect(screen.getByText("0 open")).toBeTruthy();
    expect(screen.getByText("Send the data room.").className).toContain("line-through");
    expect(screen.queryByText(/by Friday/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Cancel:/ }));
    await waitFor(() => expect(screen.getByText(/Cancelled · Yiping Lu/)).toBeTruthy());
    expect(screen.getByText("0 open")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Reopen/ }));
    await waitFor(() => expect(screen.getByText("1 open")).toBeTruthy());
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)).status)).toEqual(["done", "cancelled", "todo"]);
  });

  it("reverts and explains when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Meeting not found" }, { status: 404 })));
    render(<PersonTodos items={[item("Call the pilot customer.")]} />);
    fireEvent.click(screen.getByRole("button", { name: /Mark done/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Meeting not found"));
    expect(screen.getByRole("button", { name: /Mark done/ })).toBeTruthy();
  });

  it("lists open work first and folds two or more done items away", () => {
    const done = { status: "done" as const, updatedBy: "Riley Ng", updatedAt: "2026-10-01T00:00:00.000Z" };
    render(<PersonTodos items={[item("Done one.", { state: done }), item("Open one."), item("Done two too.", { state: done })]} />);
    expect(screen.getAllByRole("listitem").map(row => row.textContent)).toEqual([expect.stringContaining("Open one.")]);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 done" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
