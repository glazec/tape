"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, CircleDashed } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import type { PersonFollowupItem, TodoState, TodoStatus } from "@/lib/people";
import { cn } from "@/lib/utils";

const next: Record<TodoStatus, TodoStatus> = { todo: "in_progress", in_progress: "done", done: "todo" };
const actionLabel: Record<TodoStatus, string> = { todo: "Mark in progress", in_progress: "Mark done", done: "Reopen" };

/**
 * Followup to dos with team-wide progress. One click starts a to do, the next
 * marks it done, a third reopens it. Each change records who made it and when.
 */
export function PersonTodos({ items, viewerName }: { items: PersonFollowupItem[]; viewerName: string }) {
  const [states, setStates] = useState<Record<string, TodoState>>(() => Object.fromEntries(items.map(item => [
    `${item.meetingId}:${item.todoKey}`, item.state ?? { status: "todo" as const, updatedBy: null, updatedAt: null },
  ])));
  const open = Object.values(states).filter(state => state.status !== "done").length;
  // Open work first. Order is fixed at load so a row doesn't jump when clicked.
  const [order] = useState(() => [...items].sort((a, b) =>
    Number(a.state?.status === "done") - Number(b.state?.status === "done")));
  const initiallyDone = order.filter(item => item.state?.status === "done");
  const [showDone, setShowDone] = useState(initiallyDone.length < 2);
  const visible = showDone ? order : order.filter(item => item.state?.status !== "done");
  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold" id="person-followup-heading">To do</h2>
        <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{open ? `${open} open` : "All done"}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {visible.map(item => {
          const key = `${item.meetingId}:${item.todoKey}`;
          return <TodoRow item={item} key={key} setState={state => setStates(current => ({ ...current, [key]: state }))} state={states[key]} viewerName={viewerName} />;
        })}
      </ul>
      {!showDone ? (
        <Button className="mt-3" onClick={() => setShowDone(true)} size="sm" type="button" variant="outline">
          Show {initiallyDone.length} done
        </Button>
      ) : null}
    </>
  );
}

function TodoRow({ item, viewerName, state, setState }: { item: PersonFollowupItem; viewerName: string; state: TodoState; setState: (state: TodoState) => void }) {
  const [error, setError] = useState<string | null>(null);
  const status = state.status;

  async function advance() {
    const previous = state;
    const target = next[status];
    setError(null);
    setState({ status: target, updatedBy: viewerName, updatedAt: new Date().toISOString() });
    const response = await fetch(`/api/meetings/${encodeURIComponent(item.meetingId)}/todos`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ todoKey: item.todoKey, status: target }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null) as (TodoState & { error?: string }) | null;
    if (!response?.ok || !body?.status) {
      setState(previous);
      setError(body?.error ?? "Could not save. Try again.");
      return;
    }
    setState({ status: body.status, updatedBy: body.updatedBy, updatedAt: body.updatedAt });
  }

  const Icon = status === "done" ? CheckCircle2 : status === "in_progress" ? CircleDashed : Circle;
  return (
    <li className="-mx-2 flex items-start gap-1 rounded-lg px-1 py-1">
      <button
        aria-label={`${actionLabel[status]}: ${item.text}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.92] [@media(pointer:coarse)]:size-11"
        onClick={() => void advance()}
        title={actionLabel[status]}
        type="button"
      >
        <Icon className={cn("size-4 transition-colors duration-150", status === "done" && "text-foreground", status === "in_progress" && "text-foreground")} strokeWidth={status === "todo" ? 1.5 : 2} />
      </button>
      <div className="min-w-0 pt-1.5">
        <p className={cn("max-w-[60ch] break-words text-sm leading-6 text-pretty transition-colors duration-150", status === "done" && "text-muted-foreground line-through decoration-muted-foreground/60")}>
          {item.text}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {status !== "todo" && state.updatedBy ? (
            <span className="text-foreground/80">
              {status === "done" ? "Done" : "In progress"} · {state.updatedBy}
              {state.updatedAt ? <>, <LocalDateTime dateOnly value={state.updatedAt} /></> : null}
              {" · "}
            </span>
          ) : null}
          {item.timing && status !== "done" ? <>{item.timing} · </> : null}
          <Link className="underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground" href={`/meetings/${item.meetingId}?view=transcript#${item.segmentId}`}>
            {item.meetingTitle}
          </Link>
          {error ? <span className="ml-2 text-destructive" role="alert">{error}</span> : null}
        </p>
      </div>
    </li>
  );
}
