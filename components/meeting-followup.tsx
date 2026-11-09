"use client";

import { appLabelClassName } from "@/components/app-label";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Check, Copy, LoaderCircle, Pencil, Sparkles } from "lucide-react";

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
  needsTranslation = false,
  preferredLanguage = "en",
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
  needsTranslation?: boolean;
  preferredLanguage?: string;
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
  segments: Array<{ id: string; startMs: number; speaker: string | null; meetingSpeakerId?: string | null; personId?: string | null; text?: string }>;
}) {
  const chinese = preferredLanguage.toLowerCase().startsWith("zh");
  const t = (english: string, chineseText: string) => chinese ? chineseText : english;
  const relationshipLabels = chinese ? {
    knows: "认识", works_with: "合作过", met: "见过面", offered_introduction: "愿意引荐",
    promised_introduction: "承诺引荐", requested_introduction: "希望获得引荐", introduced: "已完成引荐",
    in_discussion: "正在沟通", reviewed: "已评估", invested: "已投资", mentioned: "会中提及",
  } : connectionRelationshipLabels;
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState(initialResult);
  const [connections, setConnections] = useState(initialResult?.connections ?? initialConnections);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, { personId?: string | null; meetingSpeakerId?: string | null }>>({});
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
        setGroupOverrides(current => ({ ...current, ...Object.fromEntries(visible.filter(change => change.meetingSpeakerId !== undefined).map(change => [change.id, { meetingSpeakerId: change.meetingSpeakerId, personId: change.personId }])) }));
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
  useEffect(() => {
    // Read only participants can arrive before the background job saves.
    if (!autoGenerate || canGenerate || result) return;
    const interval = setInterval(() => router.refresh(), BACKGROUND_POLL_MS);
    const deadline = setTimeout(() => clearInterval(interval), BACKGROUND_WAIT_MS);
    return () => { clearInterval(interval); clearTimeout(deadline); };
  }, [autoGenerate, canGenerate, result, router]);
  const autoGeneratedFor = useRef<string | null>(null);
  const shouldAutoGenerate = autoGenerate && ((canGenerate && !result) || needsTranslation) && segments.length > 0;
  useEffect(() => {
    if (!shouldAutoGenerate || autoGeneratedFor.current === `${sourceHash}:${preferredLanguage}:${initialConnectionsRevision}`) return;
    const poll = waitForBackground ? setInterval(() => router.refresh(), BACKGROUND_POLL_MS) : undefined;
    const timer = setTimeout(() => {
      autoGeneratedFor.current = `${sourceHash}:${preferredLanguage}:${initialConnectionsRevision}`;
      void generate();
    }, retryCount ? BACKGROUND_POLL_MS : waitForBackground && !result ? BACKGROUND_WAIT_MS : 0);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoGenerate, sourceHash, waitForBackground, retryCount, preferredLanguage, initialConnectionsRevision]);

  const [previousSegments, setPreviousSegments] = useState(segments);
  if (segments !== previousSegments) {
    setPreviousSegments(segments);
    setGroupOverrides(current => {
      const next = { ...current };
      for (const segment of segments) {
        if (next[segment.id]?.meetingSpeakerId === segment.meetingSpeakerId && next[segment.id]?.personId === segment.personId) delete next[segment.id];
      }
      return next;
    });
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
    setAnnouncement(t("Generating followup.", "正在生成会后跟进。"));
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
      if (response.status === 202) {
        if (retryCount >= 12) { setRetryCount(0); throw new Error(t("The followup is taking longer than expected. Try again shortly.", "生成时间较长，请稍后重试。")); }
        autoGeneratedFor.current = null;
        setRetryCount(count => count + 1);
        setAnnouncement(t("Followup is being prepared.", "正在整理会后跟进。"));
        router.refresh();
        return;
      }
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
          data.error || t("Could not generate the followup. Please try again.", "无法生成会后跟进，请重试。"),
        );
      }
      setResult(data.result);
      setConnections(data.result.connections ?? []);
      setConnectionsRevision(data.connectionsRevision ?? "");
      setConnectionIds(data.connectionIds ?? []);
      setAnnouncement(t("Followup ready.", "会后跟进已生成。"));
      if (needsTranslation) router.refresh();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error
          ? cause.message
          : t("Could not generate the followup. Please try again.", "无法生成会后跟进，请重试。"),
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
      const failure = new Error(data.error || t("Connection could not be saved. Try again.", "无法保存人脉信息，请重试。"));
      Object.assign(failure, { conflict: response.status === 409 });
      throw failure;
    }
    // Keep the reader's language; the English list only fills in when no translated copy exists.
    setConnections(data.translatedConnections?.[preferredLanguage] ?? data.connections);
    setConnectionsRevision(data.revision);
    setConnectionIds(data.connectionIds ?? []);
    pendingSnapshot.current = null;
    setAnnouncement(t("Connection saved.", "人脉信息已保存。"));
    router.refresh();
  }

  async function reloadConnection() {
    const targetId = editingConnection === null ? undefined : connectionIds[editingConnection];
    if (!targetId) throw new Error(t("The original connection is unavailable. Keep or copy your draft before closing.", "原人脉信息暂不可用，请在关闭前保留或复制草稿。"));
    const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/connections`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("Could not load the latest version. Try again.", "无法加载最新版本，请重试。"));
    const index = data.connectionIds.indexOf(targetId);
    if (index < 0) throw new Error(t("This connection's source changed. Your draft is still here; copy it before closing.", "这条人脉信息的来源已变更。草稿仍保留，请在关闭前复制。"));
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
      setToast({ message: t("Research prompt copied", "研究问题和会议背景已复制"), error: false });
    } catch {
      setToast({ message: t("Could not copy. Please try again.", "复制失败，请重试。"), error: true });
    }
  }

  function renderEvidence(evidence: Array<{ segmentId: string; quote?: string }>, inline = false) {
    const Wrapper = inline ? "span" : "div";
    return (
      <Wrapper className={inline ? "inline-flex flex-wrap items-center gap-x-2" :"mt-1 flex flex-wrap items-center gap-x-1"}>
        <span className={inline ? "" : "mr-1 text-xs text-muted-foreground"}>{t("Source", "来源")}</span>
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
                aria-label={chinese ? `查看 ${timestamp} 的原文` : `View source at ${timestamp}`}
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
                      {t("Transcript", "逐字稿")} · {timestamp}
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
                      {t("View in transcript", "查看逐字稿")}
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

  const groupKey = (segment: (typeof segments)[number]) => {
    const identity = groupOverrides[segment.id] ?? segment;
    return identity.personId ?? identity.meetingSpeakerId ?? segment.speaker ?? t("Unknown speaker", "未知发言人");
  };
  const connectionLabels = new Map<string, string>();
  const connectionGroups = new Map<string, MeetingConnection[]>();
  for (const connection of connections) {
    const segment = segments.find(segment => segment.id === connection.speakerSegmentId);
    if (!segment) continue;
    const speaker = (segment.id in speakerOverrides ? speakerOverrides[segment.id] : segment.speaker) || t("Unknown speaker", "未知发言人");
    const key = groupKey(segment);
    connectionLabels.set(key, speaker);
    const group = connectionGroups.get(key) ?? [];
    group.push(connection);
    connectionGroups.set(key, group);
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
    const name = (segment.id in speakerOverrides ? speakerOverrides[segment.id] : segment.speaker) || t("Unknown speaker", "未知发言人");
    const key = groupKey(segment);
    if (!speakerOptions.has(key) || segment.id === editorConnection?.speakerSegmentId) speakerOptions.set(key, { id: segment.id, name });
  }

  function renderConnections(items: MeetingConnection[]) {
    const linkClass = "rounded-sm underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return <ul className="space-y-4">
      {items.map((item, index) => (
        <li key={index} className="group/connection min-w-0 text-sm leading-6">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words">
              <a href={`#${item.speakerSegmentId}`} className={`font-medium ${linkClass}`}>
                {item.name ?? { person: t("Unnamed person", "未命名联系人"), team: t("Unnamed team", "未命名团队"), project: t("Unnamed project", "未命名项目"), organization: t("Unnamed organization", "未命名机构") }[item.kind]}
              </a>
              {item.company && item.company !== item.name ? <><span className="text-muted-foreground"> · </span><a href={`#${item.evidence[0].segmentId}`} className={`text-muted-foreground ${linkClass}`}>{item.company}</a></> : null}
              {item.title ? <span className="text-muted-foreground"> · {item.title}</span> : null}
              {item.mutual ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{t("Mutual connection", "共同人脉")}</span> : null}
            </p>
            {canGenerate && connectionsRevision ? <Button type="button" variant="ghost" size="icon-xs" className="-my-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/connection:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" disabled={busy} aria-label={chinese ? `编辑人脉：${item.name ?? item.company ?? "未命名"}` : `Edit connection: ${item.name ?? item.company ?? "Unnamed " + item.kind}`} onClick={() => { editingRef.current = connections.indexOf(item); setEditingConnection(editingRef.current); }}><Pencil aria-hidden="true" className="size-3" /></Button> : null}
          </div>
          <p className="max-w-[52ch] break-words text-pretty text-muted-foreground">{item.context}</p>
          <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span>{relationshipLabels[item.relationship]}</span>
            <span aria-hidden="true">·</span>
            {renderEvidence(item.evidence, true)}
          </div>
        </li>
      ))}
    </ul>;
  }

  const generateButton = ((canGenerate && !result) || error) ? (
    <Button disabled={busy || editingConnection !== null} onClick={generate} size="sm" variant="outline">
      {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />}
      {busy ? t("Preparing followup…", "正在整理会后跟进…") : error ? t("Retry", "重试") : t("Generate followup", "生成会后跟进")}
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
            {t("From the transcript", "会后跟进")}
          </h2>
          {result && needsTranslation && !error ? <span className="text-xs text-muted-foreground" role="status">{t("Translating followup…", "正在翻译会后跟进…")}</span> : null}
        </div>
        {result ? (
          <>
            <div className="space-y-8">
              <div>
                <h3 className={SUBHEAD}>{t("To do list", "待办事项")}</h3>
                {result.todos.length ? (
                  renderItems(result.todos)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t("No explicit next actions.", "暂无明确的后续行动。")}
                  </p>
                )}
              </div>
              <div>
                <h3 className={SUBHEAD}>{t("Dynamic", "双方需求与资源")}</h3>
                {result.dynamics.length ? (
                  renderItems(result.dynamics)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t("No explicit offers or needs.", "暂无明确的资源或需求。")}
                  </p>
                )}
              </div>
              {result.research?.length ? (
                <div>
                  <h3 className={SUBHEAD}>{t("Potential research", "待研究问题")}</h3>
                  <ul role="list" className="max-w-[60ch] space-y-3 text-sm">
                    {result.research.map((item, index) => (
                      <li className="-mx-3 min-w-0 rounded-lg px-3 pt-2 pb-1 transition-colors hover:bg-muted/40" key={index}>
                        <button
                          type="button"
                          onClick={() => void copyResearch(item)}
                          aria-label={chinese ? `复制研究问题：${item.question}` : `Copy research prompt: ${item.question}`}
                          title={t("Copy question and meeting context", "复制问题和会议背景")}
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
                {t("Writing followup from the transcript…", "正在根据逐字稿整理会后跟进…")}
              </p>
            ) : generateButton}
          </div>
        )}
        {connectionGroups.size ? (
          <div className={result ? "mt-8" : "mt-3"}>
            <h3 className={SUBHEAD}>{t("Potential connections", "潜在人脉")}</h3>
            <div className="max-w-[60ch] space-y-5">
              {orderedGroups.map(([speaker, items]) => (
                <section key={speaker} aria-label={chinese ? `${connectionLabels.get(speaker)} 提到的人脉` : `Connections mentioned by ${connectionLabels.get(speaker)}`}>
                  <h4 className="mb-1.5 text-sm font-semibold">@{connectionLabels.get(speaker)}</h4>
                  {renderConnections(items.slice(0, 3))}
                  {items.length > 3 ? (
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer content-center rounded-sm text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{chinese ? `再查看 ${items.length - 3} 条人脉` : `Show ${items.length - 3} more connections`}</summary>
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
