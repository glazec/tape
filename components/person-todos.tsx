"use client";

import { useState } from "react";
import Link from "next/link";
import { TodoStatusButton } from "@/components/todo-status-button";

import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import type { PersonFollowupItem, TodoState } from "@/lib/people";
import { cn } from "@/lib/utils";

export function PersonTodos({ items }: { items: PersonFollowupItem[] }) {
  const [states, setStates] = useState<Record<string, TodoState>>(() => Object.fromEntries(items.map(item => [
    `${item.meetingId}:${item.todoKey}`, item.state ?? { status: "todo" as const, updatedBy: null, updatedAt: null },
  ])));
  const open = Object.values(states).filter(state => state.status === "todo").length;
  // Open work first. Order is fixed at load so a row doesn't jump when clicked.
  const [order] = useState(() => [...items].sort((a, b) =>
    Number((a.state?.status ?? "todo") !== "todo") - Number((b.state?.status ?? "todo") !== "todo")));
  const initiallyDone = order.filter(item => item.state?.status === "done");
  const [showDone, setShowDone] = useState(initiallyDone.length < 2);
  const visible = showDone ? order : order.filter(item => item.state?.status !== "done");
  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold" id="person-followup-heading">To do</h2>
        <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{open ? `${open} open` : "0 open"}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {visible.map(item => {
          const key = `${item.meetingId}:${item.todoKey}`;
          return <TodoRow item={item} key={key} setState={state => setStates(current => ({ ...current, [key]: state }))} state={states[key]} />;
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

function TodoRow({ item, state, setState }: { item: PersonFollowupItem; state: TodoState; setState: (state: TodoState) => void }) {
  const status = state.status;
  return (
    <li className="-mx-2 flex items-start gap-1 rounded-lg px-1 py-1">
      <TodoStatusButton meetingId={item.meetingId} todoKey={item.todoKey} text={item.text} initialStatus={status} onSaved={setState} />
      <div className="min-w-0 pt-1.5">
        <p className={cn("max-w-[60ch] break-words text-sm leading-6 text-pretty transition-colors duration-150", status === "done" && "text-muted-foreground line-through decoration-muted-foreground/60")}>
          {item.text}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {status !== "todo" && state.updatedBy ? (
            <span className="text-foreground/80">
              {status === "done" ? "Done" : "Cancelled"} · {state.updatedBy}
              {state.updatedAt ? <>, <LocalDateTime dateOnly value={state.updatedAt} /></> : null}
              {" · "}
            </span>
          ) : null}
          {item.timing && status === "todo" ? <>{item.timing} · </> : null}
          <Link className="underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground" href={`/meetings/${item.meetingId}?view=transcript#${item.segmentId}`}>
            {item.meetingTitle}
          </Link>
        </p>
      </div>
    </li>
  );
}
