"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { useAutosaveForm } from "@/components/settings-autosave";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email addresses as removable chips. The form still receives one
 * newline separated value under `name`, so the endpoint is unchanged.
 */
export function EmailChipsInput({
  ariaLabel,
  defaultEmails,
  name,
  suggestions,
}: {
  ariaLabel: string;
  defaultEmails: string[];
  name: string;
  suggestions: Array<{ email: string; label: string }>;
}) {
  const autosave = useAutosaveForm();
  const listId = useId();
  const [emails, setEmails] = useState(defaultEmails);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function commit(next: string[]) {
    setEmails(next);
    // The hidden value updates on the next render; save after it lands.
    window.setTimeout(() => autosave?.requestSave({ immediate: true }), 0);
  }

  function addDraft() {
    const value = draft.trim().replace(/[,;]+$/, "").toLowerCase();

    if (!value) return;

    if (!EMAIL_PATTERN.test(value)) {
      setError(`“${value}” is not an email address`);
      return;
    }

    setError(null);
    setDraft("");

    if (!emails.includes(value)) {
      commit([...emails, value]);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
      if (draft.trim()) {
        event.preventDefault();
        addDraft();
      }
      return;
    }

    if (event.key === "Backspace" && !draft && emails.length > 0) {
      commit(emails.slice(0, -1));
    }
  }

  const labelFor = (email: string) =>
    suggestions.find((suggestion) => suggestion.email === email)?.label ?? email;

  return (
    <div className="flex flex-col gap-1.5">
      <input name={name} type="hidden" value={emails.join("\n")} />
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background p-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {emails.map((email) => (
          <span
            className="inline-flex items-center gap-1 rounded bg-muted py-0.5 pr-0.5 pl-2 text-sm"
            key={email}
            title={email}
          >
            {labelFor(email)}
            <button
              aria-label={`Remove ${email}`}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => commit(emails.filter((item) => item !== email))}
              type="button"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        <input
          aria-label={ariaLabel}
          className="min-w-40 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
          list={listId}
          onBlur={addDraft}
          // Typing here must not trigger the form's own save-on-change.
          onChange={(event) => {
            event.stopPropagation();
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={emails.length ? "Add someone" : "Add by name or email"}
          type="text"
          value={draft}
        />
        <datalist id={listId}>
          {suggestions
            .filter((suggestion) => !emails.includes(suggestion.email))
            .map((suggestion) => (
              <option key={suggestion.email} value={suggestion.email}>
                {suggestion.label}
              </option>
            ))}
        </datalist>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
