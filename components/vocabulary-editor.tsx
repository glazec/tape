"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useSettingsSaveStatus } from "@/components/settings-autosave";

type VocabularyTerm = { id: string; term: string; hint: string | null };

/**
 * Terms and hints as a two column table: Enter adds a row, × removes one.
 * Both write straight away and report through the page's save indicator.
 */
export function VocabularyEditor({
  endpoint,
  terms,
}: {
  endpoint: string;
  terms: VocabularyTerm[];
}) {
  const router = useRouter();
  const setStatus = useSettingsSaveStatus();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  async function addTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    if (!String(data.get("term") ?? "").trim()) return;

    setIsAdding(true);
    setStatus({ state: "saving" });

    try {
      const response = await fetch(endpoint, {
        body: data,
        method: "POST",
        redirect: "manual",
      });

      if (response.type === "opaqueredirect" || response.ok) {
        form.reset();
        setStatus({ state: "saved" });
        router.refresh();
      } else {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStatus({ state: "error", message: body?.error ?? "Could not add the term" });
      }
    } catch {
      setStatus({ state: "error", message: "Could not add the term" });
    } finally {
      setIsAdding(false);
    }
  }

  async function removeTerm(term: VocabularyTerm) {
    setPendingIds((current) => new Set(current).add(term.id));
    setStatus({ state: "saving" });

    try {
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("termId", term.id);
      const response = await fetch(url, { method: "DELETE" });

      if (!response.ok) throw new Error("Remove failed");

      setStatus({ state: "saved" });
      router.refresh();
    } catch {
      setStatus({ state: "error", message: `Could not remove ${term.term}` });
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(term.id);
        return next;
      });
    }
  }

  const visibleTerms = terms.filter((term) => !pendingIds.has(term.id));

  return (
    <div className="flex flex-col gap-3">
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
        onSubmit={addTerm}
      >
        <Input
          aria-label="Vocabulary term"
          className="h-9"
          disabled={isAdding}
          name="term"
          placeholder="Add a term"
        />
        <Input
          aria-label="Vocabulary hint"
          className="h-9"
          disabled={isAdding}
          name="hint"
          placeholder="How it is said, optional · press Enter"
        />
        <button className="sr-only" type="submit">
          Add term
        </button>
      </form>
      {visibleTerms.length > 0 ? (
        <table className="w-full border-collapse text-sm">
          <thead className="sr-only">
            <tr>
              <th>Term</th>
              <th>Hint</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleTerms.map((term) => (
              <tr className="group" key={term.id}>
                <td className="w-48 py-2 pr-4 align-top font-medium">{term.term}</td>
                <td className="py-2 pr-2 align-top text-muted-foreground">
                  {term.hint ?? ""}
                </td>
                <td className="w-8 py-1 text-right align-top">
                  <button
                    aria-label={`Remove ${term.term}`}
                    className="inline-flex size-7 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
                    onClick={() => void removeTerm(term)}
                    type="button"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">No team vocabulary yet.</p>
      )}
    </div>
  );
}
