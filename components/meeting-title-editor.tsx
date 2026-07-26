"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MeetingTitleEditorProps = {
  meetingId: string;
  meetingTitle: string;
};

export function MeetingTitleEditor({
  meetingId,
  meetingTitle,
}: MeetingTitleEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(meetingTitle);
  const [draftTitle, setDraftTitle] = useState(meetingTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraftTitle(title);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftTitle(title);
    setError(null);
    setIsEditing(false);
  }

  async function saveTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = draftTitle.trim();

    if (!nextTitle) {
      setError("Meeting title cannot be empty.");
      return;
    }

    if (nextTitle === title) {
      setIsEditing(false);
      setError(null);
      return;
    }

    setIsSaving(true);
    setError(null);

    const response = await fetch(
      `/api/meetings/${encodeURIComponent(meetingId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: nextTitle }),
      },
    );

    setIsSaving(false);

    if (!response.ok) {
      setError("Could not rename this meeting.");
      return;
    }

    setTitle(nextTitle);
    setDraftTitle(nextTitle);
    setIsEditing(false);
    router.refresh();
  }

  if (isEditing) {
    return (
      <form className="min-w-0 flex-1" onSubmit={saveTitle}>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            aria-label="Meeting title"
            className="h-10 min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl"
            disabled={isSaving}
            onChange={(event) => setDraftTitle(event.target.value)}
            value={draftTitle}
          />
          <Button
            aria-label="Save meeting title"
            disabled={isSaving}
            size="icon"
            title="Save meeting title"
            type="submit"
          >
            <Check />
          </Button>
          <Button
            aria-label="Cancel rename"
            disabled={isSaving}
            onClick={cancelEditing}
            size="icon"
            title="Cancel rename"
            type="button"
            variant="outline"
          >
            <X />
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-sm font-medium text-destructive">{error}</p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <h1 className="min-w-0 text-3xl font-semibold tracking-tight">{title}</h1>
      <Button
        aria-label="Rename meeting"
        onClick={startEditing}
        size="icon-sm"
        title="Rename meeting"
        type="button"
        variant="ghost"
      >
        <Pencil />
      </Button>
    </div>
  );
}
