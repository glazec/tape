"use client";

import { useState } from "react";
import { CheckCircle2, Circle, CircleX } from "lucide-react";
import type { TodoState, TodoStatus } from "@/lib/people";

const next: Record<TodoStatus, TodoStatus> = { todo: "done", done: "cancelled", cancelled: "todo" };
const labels = {
  todo: ["To do", "待办", "Mark done", "标为已完成"],
  done: ["Done", "已完成", "Cancel", "取消待办"],
  cancelled: ["Cancelled", "已取消", "Reopen", "重新打开"],
};

export function TodoStatusButton({ meetingId, todoKey, text, initialStatus = "todo", chinese = false, onSaved }: {
  meetingId: string; todoKey: string; text: string; initialStatus?: TodoStatus;
  chinese?: boolean; onSaved?: (state: TodoState) => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const Icon = status === "done" ? CheckCircle2 : status === "cancelled" ? CircleX : Circle;
  async function advance() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/todos`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ todoKey, status: next[status] }),
      });
      const state = await response.json();
      if (!response.ok || !Object.hasOwn(next, state.status)) throw new Error(state.error);
      setStatus(state.status);
      onSaved?.(state);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : chinese ? "保存失败，请重试。" : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }
  const action = labels[status][chinese ? 3 : 2];
  return <span className="inline-flex flex-wrap items-center gap-1">
    <button type="button" disabled={saving} onClick={advance} title={action}
      aria-label={`${action}: ${text}`} className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground">
      <Icon className="size-4" />{labels[status][chinese ? 1 : 0]}
    </button>
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </span>;
}
