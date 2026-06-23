"use client";

import { FormEvent, useState } from "react";

type FormState = "idle" | "saving" | "scheduled" | "error";

export function MeetingLinkForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const meetingUrl = String(formData.get("meeting-link") ?? "").trim();

    if (!meetingUrl) {
      setState("error");
      setMessage("Enter a Google Meet or Zoom link");
      return;
    }

    try {
      const response = await fetch("/api/meetings/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingUrl }),
      });

      if (!response.ok) {
        throw new Error("Meeting bot request failed");
      }

      setState("scheduled");
      setMessage("Meeting bot scheduled");
    } catch {
      setState("error");
      setMessage("Meeting bot could not be scheduled");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-white p-5"
    >
      <label htmlFor="meeting-link" className="text-sm font-medium">
        Meeting link
      </label>
      <input
        id="meeting-link"
        name="meeting-link"
        type="url"
        placeholder="https://meet.google.com/example"
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
      />
      <button
        type="submit"
        disabled={state === "saving"}
        className="w-fit rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {state === "saving" ? "Scheduling..." : "Save meeting link"}
      </button>
      {message ? (
        <p
          className={
            state === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"
          }
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
