"use client";

import { appLabelClassName } from "@/components/app-label";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Check, Copy, LoaderCircle, Pencil, RefreshCw, Sparkles } from "lucide-react";

import { ConnectionEditor } from "@/components/connection-editor";
import { Button } from "@/components/ui/button";
import type { MeetingFollowup as Followup } from "@/lib/meeting-followup";
import { buildMeetingResearchPrompt } from "@/lib/meeting-research-prompt";
import { connectionRelationshipLabels, isOrganizationSpeaker, SPEAKER_LABELS_CHANGED, type ConnectionChanges, type MeetingConnection, type SpeakerLabelsChanged } from "@/lib/meeting-connections";

const EMPTY_CONNECTIONS: MeetingConnection[] = [];
const EMPTY_IDS: string[] = [];
const SUBHEAD = `mb-2 ${appLabelClassName}`;
const BACKGROUND_POLL_MS = 15_000;
const BACKGROUND_WAIT_MS = 3 * 60_000;

export function MeetingFollowup({
  autoGenerate = false,
  waitForBackground = false,
  canGenerate,
  initialResult,
  initialConnections = EMPTY_CONNECTIONS,
  initialConnectionsRevision = "",
  initialConnectionIds = EMPTY_IDS,
  organizationDomains = [],
  participants = [],
  meetingId,
  meetingTitle,
  meetingStartedAt,
  sourceHash,
  segments,
}: {
  autoGenerate?: boolean;
  /** The transcript just finished, so the background job is likely generating already. */
  waitForBackground?: boolean;
  canGenerate: boolean;
  initialResult: Followup | null;
  initialConnections?: MeetingConnection[];
  initialConnectionsRevision?: string;
  initialConnectionIds?: string[];
  organizationDomains?: string[];
  participants?: Array<{ name: string | null; email: string }>;
  meetingId: string;
  meetingTitle: string;
  meetingStartedAt: string | null;
  sourceHash: string;
  segments: Array<{ id: string; startMs: number; speaker: string | null; text?: string }>;
}) {
  const [result, setResult] = useState(initialResult);
  const [connections, setConnections] = useState(initialResult?.connections ?? initialConnections);
  const [speakerOverrides, setSpeakerOverrides] = useState<Record<string, string | null>>({});
  const [speakerIdentities, setSpeakerIdentities] = useState<Record<string, { label: string | null; identity: string | null }>>({});
  const [connectionsRevision, setConnectionsRevision] = useState(initialConnectionsRevision);
  const [connectionIds, setConnectionIds] = useState(initialConnectionIds);
  const editingRef = useRef<number | null>(null);
  const pendingSnapshot = useRef<(() => void) | null>(null);
  const [editingConnection, setEditingConnection] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const applySnapshot = () => {
      setResult(initialResult);
      setConnections(initialResult?.connections ?? initialConnections);
      setConnectionsRevision(initialConnectionsRevision);
      setConnectionIds(initialConnectionIds);
    };
    if (editingRef.current !== null) pendingSnapshot.current = applySnapshot;
    else applySnapshot();
  }, [initialResult, initialConnections, initialConnectionsRevision, initialConnectionIds]);
  const pending = useRef<AbortController | null>(null);
  const headingId = useId();
  const router = useRouter();
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const update = (event: Event) => {
      const changes = (event as CustomEvent<SpeakerLabelsChanged>).detail;
      const visible = changes.filter(change => segments.some(segment => segment.id === change.id));
      if (visible.length) {
        setSpeakerOverrides(current => ({ ...current, ...Object.fromEntries(visible.map(change => [change.id, change.speaker])) }));
        setSpeakerIdentities(current => ({ ...current, ...Object.fromEntries(visible.map(change => [change.id,
          { label: change.speaker, identity: change.participantEmail ?? (participants.some(person => person.name === change.speaker || person.email === change.speaker)
            ? change.speaker : current[change.id]?.identity ?? segments.find(segment => segment.id === change.id)?.speaker ?? null) },
        ])) }));
      }
    };
    window.addEventListener(SPEAKER_LABELS_CHANGED, update);
    return () => window.removeEventListener(SPEAKER_LABELS_CHANGED, update);
  }, [segments, participants]);

  // Generate once per transcript version when no followup exists yet; errors fall back to the Retry button.
  // A just finished transcript is already being handled by the background job, so poll for its
  // result first and only generate here if it never arrives.
  const autoGeneratedFor = useRef<string | null>(null);
  const shouldAutoGenerate = autoGenerate && canGenerate && !result && segments.length > 0;
  useEffect(() => {
    if (!shouldAutoGenerate || autoGeneratedFor.current === sourceHash) return;
    const poll = waitForBackground ? setInterval(() => router.refresh(), BACKGROUND_POLL_MS) : undefined;
    const timer = setTimeout(() => {
      autoGeneratedFor.current = sourceHash;
      void generate();
    }, waitForBackground ? BACKGROUND_WAIT_MS : 0);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoGenerate, sourceHash, waitForBackground]);

  const [previousSegments, setPreviousSegments] = useState(segments);
  if (segments !== previousSegments) {
    setPreviousSegments(segments);
    setSpeakerOverrides(current => {
      const acknowledged = segments.filter(segment => segment.id in current && current[segment.id] === segment.speaker);
      if (!acknowledged.length) return current;
      const next = { ...current };
      for (const segment of acknowledged) delete next[segment.id];
      return next;
    });
  }

  if (!canGenerate && !result && !connections.length) return null;

  async function generate() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setAnnouncement("Generating followup.");
    try {
      const response = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/followup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceHash }),
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (
          response.status === 401 ||
          response.status === 404 ||
          response.status === 409
        ) {
          setResult(null);
          setConnections([]);
          router.refresh();
        }
        throw new Error(
          data.error || "Could not generate the followup. Please try again.",
        );
      }
      setResult(data.result);
      setConnections(data.result.connections ?? []);
      setConnectionsRevision(data.connectionsRevision ?? "");
      setConnectionIds(data.connectionIds ?? []);
      setAnnouncement("Followup ready.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not generate the followup. Please try again.",
      );
      setAnnouncement("");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }

  async function saveConnection(changes: ConnectionChanges) {
    const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/connections`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: connectionsRevision, index: editingConnection, changes }),
    });
    const data = await response.json();
    if (!response.ok) {
      const failure = new Error(data.error || "Connection could not be saved. Try again.");
      Object.assign(failure, { conflict: response.status === 409 });
      throw failure;
    }
    setConnections(data.connections);
    setConnectionsRevision(data.revision);
    setConnectionIds(data.connectionIds ?? []);
    pendingSnapshot.current = null;
    setAnnouncement("Connection saved.");
    router.refresh();
  }

  async function reloadConnection() {
    const targetId = editingConnection === null ? undefined : connectionIds[editingConnection];
    if (!targetId) throw new Error("The original connection is unavailable. Keep or copy your draft before closing.");
    const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/connections`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the latest version. Try again.");
    const index = data.connectionIds.indexOf(targetId);
    if (index < 0) throw new Error("This connection's source changed. Your draft is still here; copy it before closing.");
    setConnections(data.connections); setConnectionIds(data.connectionIds); setConnectionsRevision(data.revision);
    editingRef.current = index; setEditingConnection(index);
    return data.connections[index] as MeetingConnection;
  }

  async function copyResearch(item: Followup["research"][number]) {
    try {
      await navigator.clipboard.writeText(buildMeetingResearchPrompt({
        item,
        title: meetingTitle,
        startedAt: meetingStartedAt,
        url: `${window.location.origin}/meetings/${encodeURIComponent(meetingId)}`,
        segments,
      }));
      setToast({ message: "Research prompt copied", error: false });
    } catch {
      setToast({ message: "Could not copy. Please try again.", error: true });
    }
  }

  function renderEvidence(evidence: Array<{ segmentId: string; quote?: string }>, inline = false) {
    const Wrapper = inline ? "span" : "div";
    return (
      <Wrapper className={inline ? "inline-flex flex-wrap items-center gap-x-2" :"mt-1 flex flex-wrap items-center gap-x-1"}>
        <span className={inline ? "" : "mr-1 text-xs text-muted-foreground"}>Source</span>
        {evidence.map((evidence, evidenceIndex) => {
          const segment = segments.find(
            (segment) => segment.id === evidence.segmentId,
          );
          if (!segment) return null;
          const seconds = Math.floor(segment.startMs / 1000);
          const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
          return (
            <Popover.Root key={evidenceIndex}>
              <Popover.Trigger
                aria-label={`View source at ${timestamp}`}
                className={`group/source inline-flex cursor-pointer items-center justify-center rounded-md text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${inline ? "min-h-11 sm:min-h-7" : "min-h-11 min-w-11"}`}
                openOnHover
                delay={150}
                closeDelay={150}
              >
                <span className={`${inline ? "px-0" : "px-2"} py-1 underline decoration-muted-foreground/40 underline-offset-4 group-hover/source:decoration-foreground`}>
                  {timestamp}
                </span>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  side="top"
                  align="start"
                  sideOffset={6}
                  collisionPadding={16}
                  className="z-50"
                >
                  <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none">
                    <Popover.Title className="text-xs font-medium text-muted-foreground">
                      Transcript · {timestamp}
                    </Popover.Title>
                    <Popover.Description className="mt-2 max-h-60 overflow-y-auto break-words text-sm leading-6">
                      “{evidence.quote ?? segment.text}”
                    </Popover.Description>
                    <Popover.Close
                      render={<a href={`#${evidence.segmentId}`} />}
                      nativeButton={false}
                      role="link"
                      className="mt-1 inline-flex min-h-11 items-center rounded-sm text-xs font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      View in transcript
                    </Popover.Close>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
      </Wrapper>
    );
  }

  function renderItems(items: Followup["dynamics"] | Followup["todos"]) {
    return (
      <ul className="space-y-4">
        {items.map((item, index) => (
          <li className="min-w-0 text-sm leading-6" key={index}>
            <p className="max-w-[60ch] break-words text-pretty">
              <span className="font-semibold">@{item.person}</span>
              {item.text.slice(item.person.length)}
            </p>
            <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
              {"timing" in item &&
              typeof item.timing === "string" &&
              item.timing ? (
                <>
                  <span>{item.timing}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              {renderEvidence(item.evidence, true)}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const connectionGroups = new Map<string, MeetingConnection[]>();
  for (const connection of connections) {
    const segment = segments.find(segment => segment.id === connection.speakerSegmentId);
    if (!segment) continue;
    const speaker = (segment.id in speakerOverrides ? speakerOverrides[segment.id] : segment.speaker) || "Unknown speaker";
    const group = connectionGroups.get(speaker) ?? [];
    group.push(connection);
    connectionGroups.set(speaker, group);
  }

  const orderedGroups = [...connectionGroups].sort(([, first], [, second]) => {
    const internal = (items: MeetingConnection[]) => items.every(item => {
      const label = item.speakerSegmentId in speakerOverrides ? speakerOverrides[item.speakerSegmentId] : segments.find(segment => segment.id === item.speakerSegmentId)?.speaker ?? null;
      const known = speakerIdentities[item.speakerSegmentId];
      return isOrganizationSpeaker(known?.label === label ? known.identity : label, participants, organizationDomains);
    });
    return Number(internal(first)) - Number(internal(second));
  });
  const editorConnection = editingConnection === null ? null : connections[editingConnection];
  const speakerOptions = new Map<string, { id: string; name: string }>();
  for (const segment of segments) {
    const name = (segment.id in speakerOverrides ? speakerOverrides[segment.id] : segment.speaker) || "Unknown speaker";
    if (!speakerOptions.has(name) || segment.id === editorConnection?.speakerSegmentId) speakerOptions.set(name, { id: segment.id, name });
  }

  function renderConnections(items: MeetingConnection[]) {
    const linkClass = "rounded-sm underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return <ul className="space-y-4">
      {items.map((item, index) => (
        <li key={index} className="group/connection min-w-0 text-sm leading-6">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words">
              <a href={`#${item.speakerSegmentId}`} className={`font-medium ${linkClass}`}>
                {item.name ?? { person: "Unnamed person", team: "Unnamed team", project: "Unnamed project" }[item.kind]}
              </a>
              {item.company && item.company !== item.name ? <><span className="text-muted-foreground"> · </span><a href={`#${item.evidence[0].segmentId}`} className={`text-muted-foreground ${linkClass}`}>{item.company}</a></> : null}
              {item.title ? <span className="text-muted-foreground"> · {item.title}</span> : null}
              {item.mutual ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Mutual connection</span> : null}
            </p>
            {canGenerate && connectionsRevision ? <Button type="button" variant="ghost" size="icon-xs" className="-my-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/connection:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" disabled={busy} aria-label={`Edit connection: ${item.name ?? item.company ?? "Unnamed " + item.kind}`} onClick={() => { editingRef.current = connections.indexOf(item); setEditingConnection(editingRef.current); }}><Pencil aria-hidden="true" className="size-3" /></Button> : null}
          </div>
          <p className="max-w-[52ch] break-words text-pretty text-muted-foreground">{item.context}</p>
          <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span>{connectionRelationshipLabels[item.relationship]}</span>
            <span aria-hidden="true">·</span>
            {renderEvidence(item.evidence, true)}
          </div>
        </li>
      ))}
    </ul>;
  }

  const generateButton = canGenerate ? (
    <Button
      className={
        result && !error
          ? "min-h-11 min-w-11 text-muted-foreground hover:text-foreground"
          : "min-h-11 gap-2 sm:min-h-8"
      }
      title={result && !error ? "Regenerate followup" : undefined}
      disabled={busy || editingConnection !== null}
      onClick={generate}
      size={result && !error ? "icon-sm" : "sm"}
      variant={error || !result ? "outline" : "ghost"}
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      ) : result && !error ? (
        <RefreshCw aria-hidden="true" className="size-3.5" />
      ) : null}
      <span className={result && !error ? "sr-only" : undefined}>
        {busy
          ? "Generating followup…"
          : error
            ? "Retry"
            : result
              ? "Regenerate"
              : "Generate followup"}
      </span>
    </Button>
  ) : null;

  return (
    <div className="mb-12">
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <section
        aria-labelledby={headingId}

        aria-busy={busy}
      >
        <div className="mb-6 flex min-h-8 items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-base font-semibold" id={headingId}>
            <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
            From the transcript
          </h2>
          {result && !error && canGenerate ? generateButton : null}
        </div>
        {result ? (
          <>
            <div className="space-y-8">
              <div>
                <h3 className={SUBHEAD}>To do list</h3>
                {result.todos.length ? (
                  renderItems(result.todos)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    No explicit next actions.
                  </p>
                )}
              </div>
              <div>
                <h3 className={SUBHEAD}>Dynamic</h3>
                {result.dynamics.length ? (
                  renderItems(result.dynamics)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    No explicit offers or needs.
                  </p>
                )}
              </div>
              {result.research?.length ? (
                <div>
                  <h3 className={`${SUBHEAD} mb-0.5`}>Potential research</h3>
                  <p className="mb-3 text-xs leading-5 text-muted-foreground">
                    Copy a question with meeting context for AI research.
                  </p>
                  <ul role="list" className="max-w-[60ch] space-y-3 text-sm">
                    {result.research.map((item, index) => (
                      <li className="-mx-3 min-w-0 rounded-lg px-3 pt-2 pb-1 transition-colors hover:bg-muted/40" key={index}>
                        <button
                          type="button"
                          onClick={() => void copyResearch(item)}
                          aria-label={`Copy research prompt: ${item.question}`}
                          aria-describedby={`${headingId}-research-${index}`}
                          className="flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-md text-left leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0 flex-1 break-words text-pretty">
                            <span className="block font-semibold">
                              {item.question}
                              <Copy aria-hidden="true" className="ml-2 inline size-3.5 align-[-0.125em] text-muted-foreground" />
                            </span>
                            <span
                              id={`${headingId}-research-${index}`}
                              className="block text-muted-foreground"
                            >
                              {item.evidenceToCollect}
                            </span>
                          </span>
                        </button>
                        <div className="flex text-xs text-muted-foreground">{renderEvidence(item.evidence, true)}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="pb-1">
            {error ? null : shouldAutoGenerate ? (
              <p className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                Writing followup from the transcript…
              </p>
            ) : generateButton}
          </div>
        )}
        {connectionGroups.size ? (
          <div className={result ? "mt-8" : "mt-3"}>
            <h3 className={SUBHEAD}>Potential connections</h3>
            <div className="max-w-[60ch] space-y-5">
              {orderedGroups.map(([speaker, items]) => (
                <section key={speaker} aria-label={`Connections mentioned by ${speaker}`}>
                  <h4 className="mb-1.5 text-sm font-semibold">@{speaker}</h4>
                  {renderConnections(items.slice(0, 3))}
                  {items.length > 3 ? (
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Show {items.length - 3} more connections</summary>
                      <div className="mt-2">{renderConnections(items.slice(3))}</div>
                    </details>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <p className="min-w-0 flex-1 text-sm leading-6 text-destructive" role="alert">
              {error}
            </p>
            {generateButton}
          </div>
        ) : null}
      </section>
      {editorConnection ? <ConnectionEditor connection={editorConnection} speakers={[...speakerOptions.values()]} onClose={() => { editingRef.current = null; setEditingConnection(null); pendingSnapshot.current?.(); pendingSnapshot.current = null; }} onReload={reloadConnection} onSave={saveConnection} /> : null}
      <div
        role={toast?.error ? "alert" : "status"}
        aria-atomic="true"
        className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2"
      >
        {toast ? (
          <div className="flex items-center gap-2 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md">
            {!toast.error ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
            {toast.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
