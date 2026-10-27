// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { EmailChipsInput } from "@/components/email-chips-input";
import {
  AutosaveForm,
  SettingsSaveStatus,
  SettingsSaveStatusProvider,
} from "@/components/settings-autosave";

function renderForm() {
  return render(
    <SettingsSaveStatusProvider>
      <SettingsSaveStatus />
      <AutosaveForm action="/api/team/configuration?teamId=team">
        <label htmlFor="teamName">Team name</label>
        <input defaultValue="Old" id="teamName" name="teamName" required />
        <EmailChipsInput
          ariaLabel="Add a sharing group member"
          defaultEmails={["jocy@iosg.vc"]}
          name="shareAudienceEmails"
          suggestions={[{ email: "jocy@iosg.vc", label: "Jocy" }]}
        />
      </AutosaveForm>
    </SettingsSaveStatusProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, type: "basic", json: async () => ({}) }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("settings autosave", () => {
  it("saves typed changes after a pause and reports Saved", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "New name" },
    });

    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("teamName")).toBe("New name");
    expect(body.get("shareAudienceEmails")).toBe("jocy@iosg.vc");
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("shows the server's error instead of Saved", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      type: "basic",
      json: async () => ({ error: "Team name is too long" }),
    } as Response);
    renderForm();
    fireEvent.change(screen.getByLabelText("Team name"), {
      target: { value: "x" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Team name is too long",
    );
  });

  it("adds and removes member chips, saving each change", async () => {
    renderForm();
    const input = screen.getByLabelText("Add a sharing group member");
    fireEvent.change(input, { target: { value: "frank@iosg.vc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    let body = (vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit).body as FormData;
    expect(body.get("shareAudienceEmails")).toBe("jocy@iosg.vc\nfrank@iosg.vc");

    fireEvent.click(screen.getByRole("button", { name: "Remove jocy@iosg.vc" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    body = (vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit).body as FormData;
    expect(body.get("shareAudienceEmails")).toBe("frank@iosg.vc");
  });

  it("rejects text that is not an email address", () => {
    renderForm();
    const input = screen.getByLabelText("Add a sharing group member");
    fireEvent.change(input, { target: { value: "frank" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("alert").textContent).toContain("not an email");
    expect(fetch).not.toHaveBeenCalled();
  });
});
