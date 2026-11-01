"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Check, Copy, LoaderCircle, Pencil, RefreshCw } from "lucide-react";

import { ConnectionEditor } from "@/components/connection-editor";
import { Button } from "@/components/ui/button";
import type { MeetingFollowup as Followup } from "@/lib/meeting-followup";
import { buildMeetingResearchPrompt } from "@/lib/meeting-research-prompt";
import { connectionRelationshipLabels, isOrganizationSpeaker, SPEAKER_LABELS_CHANGED, type ConnectionChanges, type MeetingConnection, type SpeakerLabelsChanged } from "@/lib/meeting-connections";

const EMPTY_CONNECTIONS: MeetingConnection[] = [];
const EMPTY_IDS: string[] = [];

export function MeetingFollowup({
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

  function renderEvidence(evidence: Array<{ segmentId: string; quote?: string }>) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-1">
        <span className="mr-1 text-xs text-muted-foreground">Source</span>
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
                className="group/source inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                openOnHover
                delay={150}
                closeDelay={150}
              >
                <span className="px-2 py-1 underline decoration-muted-foreground/40 underline-offset-4 group-hover/source:decoration-foreground">
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
      </div>
    );
  }

  function renderItems(items: Followup["dynamics"] | Followup["todos"]) {
    return (
      <ul className="space-y-4">
        {items.map((item, index) => (
          <li className="min-w-0 text-sm leading-6" key={index}>
            <p className="max-w-[52ch] break-words text-pretty">
              <span className="font-semibold">@{item.person}</span>
              {item.text.slice(item.person.length)}
            </p>
            {"timing" in item &&
            typeof item.timing === "string" &&
            item.timing ? (
              <p className="mt-1 max-w-[60ch] text-xs leading-5 text-muted-foreground">
                {item.timing}
              </p>
            ) : null}
            {renderEvidence(item.evidence)}
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
    return <ul className="space-y-4">
      {items.map((item, index) => (
        <li key={index} className="min-w-0 text-sm leading-6">
          <p className="break-words font-medium">
            <a href={`#${item.speakerSegmentId}`} className="rounded-sm underline decoration-muted-foreground/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {item.name ?? { person: "Unnamed person", team: "Unnamed team", project: "Unnamed project" }[item.kind]}
            </a>
            {item.company && item.company !== item.name ? <><span className="font-normal text-muted-foreground"> · </span><a href={`#${item.evidence[0].segmentId}`} className="rounded-sm font-normal underline decoration-muted-foreground/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.company}</a></> : null}
            {item.title ? <span className="font-normal text-muted-foreground"> · {item.title}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">{connectionRelationshipLabels[item.relationship]}{item.mutual ? <span className="ml-2 font-medium text-foreground">Mutual connection</span> : null}</p>
          <p className="mt-1 max-w-[52ch] break-words text-pretty">{item.context}</p>
          <div className="flex items-end justify-between gap-2">
            {renderEvidence(item.evidence)}
            {canGenerate && connectionsRevision ? <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 shrink-0 text-muted-foreground" disabled={busy} aria-label={`Edit connection: ${item.name ?? item.company ?? "Unnamed " + item.kind}`} onClick={() => { editingRef.current = connections.indexOf(item); setEditingConnection(editingRef.current); }}><Pencil aria-hidden="true" className="size-3.5" /></Button> : null}
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
    <div className="mb-10">
      <p
        aria-hidden="true"
        className="mb-2 text-xs font-medium text-muted-foreground"
      >
        AI followup
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <section
        aria-labelledby={headingId}

        aria-busy={busy}
      >
        <h2 className="sr-only" id={headingId}>
          AI followup
        </h2>
        {result ? (
          <>
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-semibold">To do list</h3>
                {result.todos.length ? (
                  renderItems(result.todos)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    No explicit next actions.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Dynamic</h3>
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
                  <h3 className="mb-1 text-sm font-semibold">Potential research</h3>
                  <p className="mb-3 text-xs leading-5 text-muted-foreground">
                    Copy a question with meeting context for AI research.
                  </p>
                  <ul role="list" className="max-w-[60ch] space-y-5 text-sm">
                    {result.research.map((item, index) => (
                      <li className="min-w-0" key={index}>
                        <button
                          type="button"
                          onClick={() => void copyResearch(item)}
                          aria-label={`Copy research prompt: ${item.question}`}
                          aria-describedby={`${headingId}-research-${index}`}
                          className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-start gap-3 rounded-md p-2 text-left leading-6 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0 flex-1 break-words text-pretty">
                            <span className="block font-semibold">{item.question}</span>
                            <span
                              id={`${headingId}-research-${index}`}
                              className="mt-1 block text-muted-foreground"
                            >
                              {item.evidenceToCollect}
                            </span>
                          </span>
                          <Copy aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        </button>
                        {renderEvidence(item.evidence)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="pb-1">{!error ? generateButton : null}</div>
        )}
        {connectionGroups.size ? (
          <div className={result ? "mt-5" : "mt-3"}>
            <h3 className="mb-3 text-sm font-semibold">Potential connections</h3>
            <div className="max-w-[60ch] space-y-5">
              {orderedGroups.map(([speaker, items]) => (
                <section key={speaker} aria-label={`Connections mentioned by ${speaker}`}>
                  <h4 className="mb-2 text-sm font-semibold">@{speaker}</h4>
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
        {result && !error && canGenerate ? (
          <div className="mt-2 flex justify-end">{generateButton}</div>
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
