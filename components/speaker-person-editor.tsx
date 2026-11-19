"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Pencil, Play, Plus, Type } from "lucide-react";

import { appLabelClassName } from "@/components/app-label";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/person-format";
import { cn } from "@/lib/utils";

export type SpeakerDirectoryPerson = {
  id: string;
  name: string;
  emails: string[];
  inMeeting?: boolean;
};

export type SpeakerDirectoryParticipant = {
  name: string;
  email: string;
};

export type SpeakerLinkedPerson = {
  id: string;
  name: string;
  email: string | null;
};

export type SpeakerEditScope = "matching_speaker" | "segment";

export type SpeakerEditDecision = {
  applyTo: SpeakerEditScope;
  speaker: string;
  linkAction: "preserve" | "link" | "create" | "unlink";
  personId?: string;
  participantEmail?: string;
  preferredName?: string;
};

/**
 * Who the speaker will be after saving. "keep" holds the person linked when
 * the editor opened; "rename" also renames that person in every meeting.
 */
type Identity =
  | { kind: "keep" }
  | { kind: "person"; person: SpeakerDirectoryPerson }
  | { kind: "participant"; participant: SpeakerDirectoryParticipant }
  | { kind: "new" }
  | { kind: "rename" }
  | { kind: "label" };

type Option =
  | { kind: "person"; key: string; person: SpeakerDirectoryPerson }
  | { kind: "participant"; key: string; participant: SpeakerDirectoryParticipant }
  | { kind: "new"; key: string }
  | { kind: "rename"; key: string }
  | { kind: "label"; key: string };

type Section = { label: string | null; options: Option[] };

const WORKSPACE_PREVIEW_COUNT = 5;
const SEARCH_RESULT_LIMIT = 20;

// Exact after trimming: a capitalization fix is a real rename, not a no-op.
function sameName(left: string, right: string) {
  return left.trim() === right.trim();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function matches(query: string, ...fields: string[]) {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some(field => field.toLowerCase().includes(needle));
}

const quietButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:min-h-7 sm:min-w-0 sm:px-1.5";

export function SpeakerPersonEditor({
  canPreview,
  initialName,
  initialPerson: persistedPerson,
  isSaving,
  onCancel,
  onPreview,
  onSubmit,
  participants,
  people,
  serverError,
  showScope,
}: {
  canPreview: boolean;
  initialName: string;
  initialPerson: SpeakerLinkedPerson | null;
  isSaving: boolean;
  onCancel: () => void;
  onPreview: () => void;
  onSubmit: (decision: SpeakerEditDecision) => void;
  participants: SpeakerDirectoryParticipant[];
  people: SpeakerDirectoryPerson[];
  serverError: string | null;
  showScope: boolean;
}) {
  const listId = useId();
  const errorId = useId();
  const promptId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [nameTouched, setNameTouched] = useState(false);
  const [scope, setScope] = useState<SpeakerEditScope>("matching_speaker");
  const [chosenIdentity, setIdentity] = useState<Identity>(persistedPerson ? { kind: "keep" } : { kind: "label" });
  const [listOpen, setListOpen] = useState(!persistedPerson);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [askedWho, setAskedWho] = useState(false);
  const [extraEmail, setExtraEmail] = useState<string | null>(null);
  const [showEmailPicker, setShowEmailPicker] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // The transcript label can differ from the person record; the record wins.
  const initialPerson = useMemo<SpeakerLinkedPerson | null>(() => {
    if (!persistedPerson) return null;
    const record = people.find(person => person.id === persistedPerson.id);
    return record ? { id: record.id, name: record.name, email: record.emails[0] ?? persistedPerson.email } : persistedPerson;
  }, [people, persistedPerson]);

  const personByEmail = useMemo(() => {
    const byEmail = new Map<string, SpeakerDirectoryPerson>();
    for (const person of people) for (const email of person.emails) byEmail.set(email.toLowerCase(), person);
    return byEmail;
  }, [people]);
  // A fallback participant chosen before the directory loaded may already be a
  // person; link them rather than creating a duplicate.
  const identity: Identity =
    chosenIdentity.kind === "participant" && personByEmail.has(chosenIdentity.participant.email.toLowerCase())
      ? { kind: "person", person: personByEmail.get(chosenIdentity.participant.email.toLowerCase())! }
      : chosenIdentity;

  const trimmedName = name.trim();
  // Until the name is edited, show everyone rather than filtering by the old label.
  const query = nameTouched ? trimmedName : "";

  const linkedPerson: SpeakerLinkedPerson | null =
    identity.kind === "keep" || identity.kind === "rename"
      ? initialPerson
      : identity.kind === "person"
        ? { id: identity.person.id, name: identity.person.name, email: identity.person.emails[0] ?? null }
        : null;

  // A linked person whose name no longer matches the typed name is ambiguous:
  // it could be someone else or a new spelling. Saving asks which.
  const needsChoice =
    nameTouched &&
    Boolean(linkedPerson) &&
    identity.kind !== "rename" &&
    trimmedName.length > 0 &&
    !sameName(trimmedName, linkedPerson!.name);
  const canRename = Boolean(initialPerson) && identity.kind === "keep" && scope === "matching_speaker";

  const looseParticipants = useMemo(() => {
    const byEmail = new Map<string, SpeakerDirectoryParticipant>();
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      if (personByEmail.has(email) || email === persistedPerson?.email?.toLowerCase()) continue;
      const existing = byEmail.get(email);
      // One row per email, preferring a real name over the bare address.
      if (!existing || (existing.name === existing.email && participant.name !== participant.email)) byEmail.set(email, participant);
    }
    return [...byEmail.values()];
  }, [participants, personByEmail, persistedPerson?.email]);

  const sections = useMemo<Section[]>(() => {
    const inMeeting: Option[] = [];
    const workspace: Option[] = [];
    for (const person of people) {
      if (!matches(query, person.name, ...person.emails)) continue;
      const option: Option = { kind: "person", key: `person:${person.id}`, person };
      (person.inMeeting ? inMeeting : workspace).push(option);
    }
    for (const participant of looseParticipants) {
      if (!matches(query, participant.name, participant.email)) continue;
      inMeeting.push({ kind: "participant", key: `participant:${participant.email}`, participant });
    }
    const actions: Option[] = [];
    if (query) {
      actions.push({ kind: "new", key: "new" });
      if (canRename && initialPerson && !sameName(query, initialPerson.name)) actions.push({ kind: "rename", key: "rename" });
      actions.push({ kind: "label", key: "label" });
    }
    return [
      { label: "In this meeting", options: inMeeting.slice(0, SEARCH_RESULT_LIMIT) },
      { label: "Workspace", options: workspace.slice(0, query ? SEARCH_RESULT_LIMIT : WORKSPACE_PREVIEW_COUNT) },
      { label: null, options: actions },
    ].filter(section => section.options.length > 0);
  }, [canRename, initialPerson, looseParticipants, people, query]);

  const options = useMemo(() => sections.flatMap(section => section.options), [sections]);
  const visibleOptions = listOpen ? options : [];
  const activeIndex = activeKey ? visibleOptions.findIndex(option => option.key === activeKey) : -1;
  const activeOption = activeIndex >= 0 ? visibleOptions[activeIndex] : undefined;
  const listShown = visibleOptions.length > 0;
  const asking = askedWho && needsChoice;

  const emailChoices =
    linkedPerson?.id && identity.kind !== "label" && identity.kind !== "new" && identity.kind !== "participant"
      ? looseParticipants.map(participant => participant.email)
      : [];

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (serverError) inputRef.current?.focus();
  }, [serverError]);

  const activeOptionKey = activeOption?.key;
  useEffect(() => {
    if (!activeOptionKey) return;
    document.getElementById(`${listId}-${activeOptionKey}`)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionKey, listId]);

  function focusInput() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function changeName(value: string) {
    setName(value);
    setNameTouched(true);
    setLocalError(null);
    setAskedWho(false);
    setListOpen(true);
    // A rename was chosen for the old text; new text needs a new choice.
    if (chosenIdentity.kind === "rename") setIdentity({ kind: "keep" });
  }

  // When the query changes, highlight a matching person so Enter links them.
  // Never preselect Create or Rename, so a bare Enter cannot add or rename
  // anyone. Directory loads keep the highlight, tracked by key.
  const [highlightQuery, setHighlightQuery] = useState(query);
  if (query !== highlightQuery) {
    setHighlightQuery(query);
    const first = options[0];
    setActiveKey(query && first && (first.kind === "person" || first.kind === "participant") ? first.key : null);
  }

  function choose(option: Option) {
    setLocalError(null);
    setAskedWho(false);
    setListOpen(false);
    setActiveKey(null);
    setExtraEmail(null);
    setShowEmailPicker(false);
    if (option.kind === "person") {
      if (initialPerson && option.person.id === initialPerson.id) setIdentity({ kind: "keep" });
      else setIdentity({ kind: "person", person: option.person });
      setName(option.person.name);
      setNameTouched(false);
    } else if (option.kind === "participant") {
      setIdentity({ kind: "participant", participant: option.participant });
      // Use the participant's real name, never a search fragment. With only an
      // address known, keep a typed full name.
      const hasRealName = option.participant.name !== option.participant.email;
      if (hasRealName || !nameTouched || !trimmedName || isEmail(trimmedName)) setName(option.participant.name);
    } else {
      setIdentity({ kind: option.kind });
    }
    focusInput();
  }

  function startChangingPerson() {
    setListOpen(true);
    setActiveKey(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function unlink() {
    setIdentity({ kind: "label" });
    setExtraEmail(null);
    setShowEmailPicker(false);
    setLocalError(null);
    focusInput();
  }

  function keepLinkedName() {
    if (!linkedPerson) return;
    setName(linkedPerson.name);
    setNameTouched(false);
    setListOpen(false);
    setAskedWho(false);
    setLocalError(null);
    focusInput();
  }

  function buildDecision(): SpeakerEditDecision | string | null {
    if (!trimmedName) return "Add a speaker name.";
    if (needsChoice) return null;
    const base = { applyTo: scope, speaker: trimmedName };
    const email = extraEmail ?? undefined;
    switch (identity.kind) {
      case "keep":
        return email && initialPerson
          ? { ...base, linkAction: "link", personId: initialPerson.id, participantEmail: email }
          : { ...base, linkAction: "preserve" };
      case "rename":
        return email && initialPerson
          ? { ...base, linkAction: "link", personId: initialPerson.id, participantEmail: email, preferredName: trimmedName }
          : { ...base, linkAction: "preserve", preferredName: trimmedName };
      case "person":
        return { ...base, linkAction: "link", personId: identity.person.id, ...(email ? { participantEmail: email } : {}) };
      case "participant":
        return { ...base, linkAction: "create", participantEmail: identity.participant.email.toLowerCase() };
      case "new":
        return { ...base, linkAction: "create" };
      case "label":
        return { ...base, linkAction: initialPerson ? "unlink" : "preserve" };
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const decision = buildDecision();
    if (decision === null) {
      // Ask, don't scold: reopen the choices with the question on top.
      setAskedWho(true);
      setListOpen(true);
      setActiveKey(null);
      focusInput();
      return;
    }
    if (typeof decision === "string") {
      setLocalError(decision);
      focusInput();
      return;
    }
    onSubmit(decision);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (!options.length) return;
      if (!listOpen) {
        setListOpen(true);
        setActiveKey(options[step > 0 ? 0 : options.length - 1].key);
        return;
      }
      const next = activeIndex + step;
      setActiveKey(next < -1 ? options[options.length - 1].key : next >= options.length || next === -1 ? null : options[next].key);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption && !(event.metaKey || event.ctrlKey)) choose(activeOption);
      else event.currentTarget.form?.requestSubmit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (listShown) {
        setListOpen(false);
        setActiveKey(null);
        if (needsChoice) keepLinkedName();
      } else onCancel();
    }
  }

  const error = localError ?? serverError;

  return (
    <form
      className="w-full max-w-lg rounded-xl bg-popover p-1.5 text-popover-foreground shadow-[0_8px_30px_-12px_oklch(0.2_0.01_30/0.22)] ring-1 ring-foreground/8 dark:ring-foreground/15"
      onSubmit={submit}
    >
      <div className="flex items-center gap-1 border-b border-border/60 pb-1">
        <input
          aria-activedescendant={activeOption ? `${listId}-${activeOption.key}` : undefined}
          aria-autocomplete="list"
          aria-controls={listShown ? listId : undefined}
          aria-busy={isSaving}
          aria-describedby={[asking ? promptId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
          aria-expanded={listShown}
          aria-invalid={Boolean(error)}
          aria-label="Speaker name"
          autoComplete="off"
          autoFocus
          className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground read-only:opacity-60 sm:h-9 sm:text-sm"
          onBlur={() => { setListOpen(false); setActiveKey(null); }}
          onChange={event => { if (!isSaving) changeName(event.target.value); }}
          onClick={() => setListOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Name or email"
          readOnly={isSaving}
          ref={inputRef}
          role="combobox"
          value={name}
        />
        {canPreview ? (
          <Button
            aria-label="Preview speaker voice"
            className="size-11 rounded-lg text-muted-foreground hover:text-foreground sm:size-8"
            disabled={isSaving}
            onClick={onPreview}
            size="icon"
            title="Play this voice"
            type="button"
            variant="ghost"
          >
            <Play className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <p aria-live="polite" className="px-2 pt-1.5 text-xs text-muted-foreground empty:hidden" id={promptId}>
        {asking && listShown ? `Who is “${trimmedName}”?` : ""}
      </p>
      {listShown ? (
        <div
          aria-label="People"
          className="mt-1 max-h-60 overflow-y-auto overscroll-contain"
          id={listId}
          // Scrollbar, labels and gaps must not blur the input and close the list.
          onMouseDown={event => event.preventDefault()}
          role="listbox"
        >
          {sections.map((section, sectionIndex) => (
            <div aria-label={section.label ?? "Actions"} className={cn(sectionIndex > 0 && "mt-1.5")} key={section.label ?? "actions"} role="group">
              {section.label ? (
                <p aria-hidden="true" className={cn(appLabelClassName, "px-2 pb-0.5 pt-1")}>{section.label}</p>
              ) : null}
              {section.options.map(option => {
                const index = options.indexOf(option);
                const selected = isSelected(option, identity, initialPerson);
                return (
                  <OptionRow
                    active={index === activeIndex}
                    id={`${listId}-${option.key}`}
                    key={option.key}
                    onHover={() => setActiveKey(option.key)}
                    onSelect={() => choose(option)}
                    selected={selected}
                  >
                    <OptionContent linkedName={initialPerson?.name ?? ""} option={option} query={query} selected={selected} />
                  </OptionRow>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <>
          <IdentityRow
            canAddEmail={emailChoices.length > 0 && !showEmailPicker && !extraEmail}
            identity={identity}
            initialPerson={initialPerson}
            isSaving={isSaving}
            linkedPerson={linkedPerson}
            name={trimmedName}
            needsChoice={needsChoice}
            onAddEmail={() => setShowEmailPicker(true)}
            onChange={startChangingPerson}
            onKeepName={keepLinkedName}
            onUndo={() => setIdentity(initialPerson ? { kind: "keep" } : { kind: "label" })}
            onUnlink={unlink}
          />
          {emailChoices.length > 0 && (showEmailPicker || extraEmail) ? (
            <label className="flex min-h-11 items-center gap-2 pl-10 pr-2 text-xs text-muted-foreground sm:min-h-8">
              <span>Email</span>
              <select
                aria-label="Associate meeting email"
                className="h-11 min-w-0 max-w-full rounded-md bg-transparent px-1 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-7"
                disabled={isSaving}
                onChange={event => setExtraEmail(event.target.value || null)}
                value={extraEmail ?? ""}
              >
                <option value="">None</option>
                {emailChoices.map(email => <option key={email} value={email}>{email}</option>)}
              </select>
            </label>
          ) : null}
        </>
      )}

      {error ? (
        <p className="px-2 pt-1 text-xs font-medium text-destructive" id={errorId} role="alert">{error}</p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pt-1">
        {showScope ? (
          <div aria-label="Apply to" className="inline-flex rounded-full bg-muted/70 p-0.5" role="group">
            {([
              ["matching_speaker", "All their lines"],
              ["segment", "This line"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={scope === value}
                className={cn(
                  "h-11 rounded-full px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-6 sm:px-2.5",
                  scope === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                disabled={isSaving}
                key={value}
                onClick={() => {
                  setScope(value);
                  if (value === "segment" && identity.kind === "rename") setIdentity({ kind: "keep" });
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : <span />}
        <div className="ml-auto flex items-center gap-1">
          <Button aria-label="Cancel speaker edit" className="h-11 sm:h-7" disabled={isSaving} onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button aria-label="Save speaker" className="h-11 sm:h-7" disabled={isSaving} size="sm" type="submit">
            {isSaving ? "Saving" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function isSelected(option: Option, identity: Identity, initialPerson: SpeakerLinkedPerson | null) {
  if (option.kind === "person") {
    if (identity.kind === "person") return identity.person.id === option.person.id;
    if (identity.kind === "keep" || identity.kind === "rename") return initialPerson?.id === option.person.id;
    return false;
  }
  if (option.kind === "participant") return identity.kind === "participant" && identity.participant.email === option.participant.email;
  return false;
}

function OptionRow({
  active,
  children,
  id,
  onHover,
  onSelect,
  selected,
}: {
  active: boolean;
  children: ReactNode;
  id: string;
  onHover: () => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <div
      aria-checked={selected}
      aria-selected={active}
      className={cn(
        "relative flex min-h-11 cursor-default items-center gap-2 rounded-lg px-2 py-1 pr-8 text-sm select-none sm:min-h-8",
        active && "bg-accent text-accent-foreground",
      )}
      id={id}
      onClick={onSelect}
      onMouseDown={event => event.preventDefault()}
      onMouseMove={onHover}
      onPointerDown={event => event.preventDefault()}
      role="option"
    >
      {children}
      {selected ? <Check aria-hidden="true" className="absolute right-2.5 size-3.5 text-foreground" /> : null}
    </div>
  );
}

function Avatar({ name, variant = "solid" }: { name: string; variant?: "solid" | "dashed" | "empty" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium",
        variant === "solid" && "bg-foreground/[0.07] text-muted-foreground",
        variant === "dashed" && "border border-dashed border-muted-foreground/50 text-muted-foreground",
        variant === "empty" && "border border-dashed border-border",
      )}
    >
      {variant === "solid" ? initials(name) : variant === "dashed" ? <Plus className="size-3" /> : null}
    </span>
  );
}

function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </span>
  );
}

function OptionContent({ linkedName, option, query, selected }: { linkedName: string; option: Option; query: string; selected: boolean }) {
  if (option.kind === "person" || option.kind === "participant") {
    const personName = option.kind === "person" ? option.person.name : option.participant.name || option.participant.email;
    const [email, ...more] = option.kind === "person" ? option.person.emails : [option.participant.email];
    const showEmail = email && email !== personName;
    return (
      <>
        <Avatar name={personName} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={cn("max-w-[75%] shrink-0 truncate", selected && "font-medium")}>{personName}</span>
          {showEmail ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{email}{more.length ? ` +${more.length}` : ""}</span>
          ) : null}
        </span>
      </>
    );
  }
  if (option.kind === "new") {
    return (
      <>
        <Avatar name={query} variant="dashed" />
        <span className="min-w-0 flex-1 truncate">Create “{query}”</span>
      </>
    );
  }
  if (option.kind === "rename") {
    return (
      <>
        <ActionIcon><Pencil className="size-3.5" /></ActionIcon>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate">Rename {linkedName} to “{query}”</span>
          <span className="shrink-0 text-xs text-muted-foreground">All meetings</span>
        </span>
      </>
    );
  }
  return (
    <>
      <ActionIcon><Type className="size-3.5" /></ActionIcon>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">Use as label only</span>
    </>
  );
}

function IdentityRow({
  canAddEmail,
  identity,
  initialPerson,
  isSaving,
  linkedPerson,
  name,
  needsChoice,
  onAddEmail,
  onChange,
  onKeepName,
  onUndo,
  onUnlink,
}: {
  canAddEmail: boolean;
  identity: Identity;
  initialPerson: SpeakerLinkedPerson | null;
  isSaving: boolean;
  linkedPerson: SpeakerLinkedPerson | null;
  name: string;
  needsChoice: boolean;
  onAddEmail: () => void;
  onChange: () => void;
  onKeepName: () => void;
  onUndo: () => void;
  onUnlink: () => void;
}) {
  const change = <button aria-label="Change person" className={quietButton} disabled={isSaving} onClick={onChange} type="button">Change</button>;
  const unlinkButton = <button className={quietButton} disabled={isSaving} onClick={onUnlink} type="button">Unlink</button>;
  const addEmail = canAddEmail
    ? <button aria-label="Add an email from this meeting" className={quietButton} disabled={isSaving} onClick={onAddEmail} type="button">Add email</button>
    : null;

  let groupLabel: string | undefined;
  let avatar: ReactNode;
  let body: ReactNode;
  let actions: ReactNode;

  if (needsChoice && linkedPerson) {
    groupLabel = `Linked to ${linkedPerson.name}`;
    avatar = <Avatar name={linkedPerson.name} />;
    body = <span className="truncate text-muted-foreground">Still {linkedPerson.name}?</span>;
    actions = (
      <>
        <button aria-label={`Keep ${linkedPerson.name}`} className={quietButton} disabled={isSaving} onClick={onKeepName} type="button">Keep</button>
        {change}
      </>
    );
  } else if (identity.kind === "label") {
    avatar = <Avatar name="" variant="empty" />;
    body = <span className="truncate text-muted-foreground">{initialPerson ? `Unlinked from ${initialPerson.name}` : "No person linked"}</span>;
    actions = initialPerson
      ? <button className={quietButton} disabled={isSaving} onClick={onUndo} type="button">Undo</button>
      : <button aria-label="Link a person" className={quietButton} disabled={isSaving} onClick={onChange} type="button">Link</button>;
  } else if (identity.kind === "new") {
    groupLabel = `New person ${name}`;
    avatar = <Avatar name={name} variant="dashed" />;
    body = (
      <>
        <span className="truncate font-medium">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">New person</span>
      </>
    );
    actions = change;
  } else if (identity.kind === "participant") {
    const shown = name || identity.participant.email;
    groupLabel = `Linked to ${shown}`;
    avatar = <Avatar name={shown} />;
    body = (
      <>
        <span className="truncate font-medium">{shown}</span>
        {shown !== identity.participant.email ? <span className="truncate text-xs text-muted-foreground">{identity.participant.email}</span> : null}
        <span className="shrink-0 text-xs text-muted-foreground">New person</span>
      </>
    );
    actions = <>{change}{unlinkButton}</>;
  } else if (identity.kind === "rename" && initialPerson) {
    groupLabel = `Linked to ${initialPerson.name}`;
    avatar = <Avatar name={name} />;
    body = (
      <>
        <span className="truncate">
          <span className="text-muted-foreground line-through decoration-muted-foreground/40">{initialPerson.name}</span>
          <span aria-hidden="true" className="px-1 text-muted-foreground">→</span>
          <span className="font-medium">{name}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">Renamed in all meetings</span>
      </>
    );
    actions = <><button className={quietButton} disabled={isSaving} onClick={onUndo} type="button">Undo</button>{addEmail}</>;
  } else if (linkedPerson) {
    groupLabel = `Linked to ${linkedPerson.name}`;
    avatar = <Avatar name={linkedPerson.name} />;
    body = (
      <>
        <span className="truncate font-medium">{linkedPerson.name}</span>
        {linkedPerson.email ? <span className="truncate text-xs text-muted-foreground">{linkedPerson.email}</span> : null}
      </>
    );
    actions = <>{addEmail}{change}{unlinkButton}</>;
  }

  return (
    <div aria-label={groupLabel} className="mt-1 flex min-h-11 items-center gap-2 px-2 sm:min-h-8" role={groupLabel ? "group" : undefined}>
      {avatar}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-sm">{body}</span>
      <span className="-mr-1 flex shrink-0 items-center">{actions}</span>
    </div>
  );
}
