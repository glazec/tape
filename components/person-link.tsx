"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

// A faint resting underline says "this opens something" without shouting.
const linkClassName =
  "rounded-sm underline decoration-muted-foreground/35 underline-offset-4 transition-[text-decoration-color] duration-150 ease-out hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A person's name that opens their page. Linked people are plain links. A
 * speaker or participant without a workspace person yet is created and linked
 * on first open, which only people who can edit the meeting's speakers may do;
 * everyone else sees plain text.
 */
export function PersonLink({
  children,
  className,
  meetingId,
  open,
  personId,
  title,
}: {
  children: ReactNode;
  className?: string;
  meetingId?: string;
  open?: { meetingSpeakerId: string } | { email: string; name: string | null } | null;
  personId?: string | null;
  title?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (personId) {
    return (
      <Link className={cn(linkClassName, className)} href={`/people/${personId}`} title={title}>
        {children}
      </Link>
    );
  }
  if (!open || !meetingId) return <span className={className} title={title}>{children}</span>;

  async function openPerson() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId!)}/people`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(open),
      });
      const body = await response.json().catch(() => null) as { personId?: string; error?: string } | null;
      if (!response.ok || !body?.personId) throw new Error(body?.error ?? "This person could not be opened. Try again.");
      router.push(`/people/${body.personId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This person could not be opened. Try again.");
      setPending(false);
    }
  }

  return (
    <button
      aria-busy={pending}
      className={cn(linkClassName, "cursor-pointer text-left", pending && "opacity-60", className)}
      onClick={() => void openPerson()}
      title={error ?? title}
      type="button"
    >
      {children}
      {pending ? <Loader2 aria-hidden="true" className="ml-1 inline size-3 animate-spin align-[-2px] text-muted-foreground" /> : null}
      {error ? <span className="ml-1 text-xs text-destructive no-underline" role="alert">{error}</span> : null}
    </button>
  );
}
