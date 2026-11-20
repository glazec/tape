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
import { AtSign, Check, CornerDownLeft, Pencil, Play, Plus, Type } from "lucide-react";

import { appLabelClassName } from "@/components/app-label";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/person-format";
import { personNameKey } from "@/lib/person-names";
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
  | { kind: "new-email"; key: string; participant: SpeakerDirectoryParticipant }
  | { kind: "rename"; key: string }
  | { kind: "label"; key: string };

type Section = { label: string | null; options: Option[] };

// Editor state before a meeting email was chosen, so Undo can return to it.
type Snapshot = { identity: Identity; name: string; touched: boolean; naming: boolean };

const WORKSPACE_PREVIEW_COUNT = 5;
const SEARCH_RESULT_LIMIT = 20;
const EMAIL_SUGGESTION_LIMIT = 3;

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

function hasRealName(participant: SpeakerDirectoryParticipant) {
  return Boolean(participant.name) && participant.name.trim().toLowerCase() !== participant.email.toLowerCase();
}

// Placeholders ("Speaker 2", "Guest"), addresses and blanks never become a
// person's name; mirrors the server's person_name_key.
function isNonName(value: string) {
  return personNameKey(value) === null;
}

// Unclaimed bare addresses from this meeting, offered with Create for a typed
// name. Named participants belong to someone else and are found by search.
// A local part token matching the name ranks first, then a matching initial.
function emailSuggestions(query: string, participants: SpeakerDirectoryParticipant[], current: SpeakerDirectoryParticipant | null) {
  // An address the search already lists needs no Create row.
  const pinned = current && !matches(query, current.name, current.email) ? [current] : [];
  // Stop when the query finds a bare address or names someone exactly.
  const needle = query.trim().toLowerCase();
  if (participants.some(participant => (!hasRealName(participant) && matches(query, participant.email)) || participant.name.trim().toLowerCase() === needle)) {
    return pinned;
  }
  const words = needle.split(/\s+/).filter(Boolean);
  const score = (participant: SpeakerDirectoryParticipant) => {
    const tokens = participant.email.split("@")[0]!.toLowerCase().split(/[._+-]+/).filter(Boolean);
    const tokenMatch = words.some(word => tokens.some(token => token.startsWith(word) || (token.length > 1 && word.startsWith(token))));
    return (tokenMatch ? 2 : 0) + (participant.email.charAt(0).toLowerCase() === words[0]?.charAt(0) ? 1 : 0);
  };
  const bare = participants.filter(participant => !hasRealName(participant) && participant.email !== current?.email);
  // One address is worth offering; among several, only ones that resemble the name.
  const ranked = bare
    .map((participant, index) => ({ participant, index, score: score(participant) }))
    .filter(entry => (bare.length === 1 && !pinned.length) || entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.participant);
  return [...pinned, ...ranked].slice(0, EMAIL_SUGGESTION_LIMIT);
}

const quietButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:min-h-7 sm:min-w-0 sm:px-1.5";

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
  const identityId = useId();
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
  // Naming: a meeting email is chosen for a new person and the field holds
  // that person's name rather than a search.
  const [namingOn, setNamingOn] = useState(false);
  const [beforePick, setBeforePick] = useState<Snapshot | null>(null);
  const [typedAfterPick, setTypedAfterPick] = useState(false);
  // Change searches from an empty query; closing without a choice restores the name.
  const [changeStash, setChangeStash] = useState<{ name: string; touched: boolean } | null>(null);

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
  // person; link them rather than creating a duplicate, under their record name
  // unless a name was typed after the pick.
  const remapTarget =
    chosenIdentity.kind === "participant" ? personByEmail.get(chosenIdentity.participant.email.toLowerCase()) : undefined;
  if (remapTarget) {
    setIdentity(initialPerson?.id === remapTarget.id ? { kind: "keep" } : { kind: "person", person: remapTarget });
    setNamingOn(false);
    setBeforePick(null);
    setChangeStash(null);
    if (!typedAfterPick) {
      setName(remapTarget.name);
      setNameTouched(false);
    }
  }
  const identity = chosenIdentity;

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
  // Text typed into a Change search without picking anyone is ambiguous too.
  const pendingSearch = Boolean(changeStash) && nameTouched && (identity.kind === "participant" || identity.kind === "new");
  const needsChoice =
    pendingSearch ||
    (nameTouched &&
      Boolean(linkedPerson) &&
      identity.kind !== "rename" &&
      trimmedName.length > 0 &&
      !sameName(trimmedName, linkedPerson!.name));
  const canRename = Boolean(initialPerson) && identity.kind === "keep" && scope === "matching_speaker";

  const looseParticipants = useMemo(() => {
    const byEmail = new Map<string, SpeakerDirectoryParticipant>();
    for (const participant of participants) {
      const email = participant.email.toLowerCase();
      if (personByEmail.has(email) || email === persistedPerson?.email?.toLowerCase()) continue;
      const existing = byEmail.get(email);
      // One row per email, preferring a real name over the bare address.
      if (!existing || (!hasRealName(existing) && hasRealName(participant))) byEmail.set(email, participant);
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
      if (!isEmail(query)) {
        // Searching again from a chosen address keeps that address on offer.
        const current = changeStash && identity.kind === "participant" && !hasRealName(identity.participant) ? identity.participant : null;
        for (const participant of emailSuggestions(query, looseParticipants, current)) {
          actions.push({ kind: "new-email", key: `new-email:${participant.email}`, participant });
        }
      }
      actions.push({ kind: "new", key: "new" });
      if (canRename && initialPerson && !sameName(query, initialPerson.name)) actions.push({ kind: "rename", key: "rename" });
      actions.push({ kind: "label", key: "label" });
    }
    return [
      { label: "In this meeting", options: inMeeting.slice(0, SEARCH_RESULT_LIMIT) },
      { label: "Workspace", options: workspace.slice(0, query ? SEARCH_RESULT_LIMIT : WORKSPACE_PREVIEW_COUNT) },
      { label: null, options: actions },
    ].filter(section => section.options.length > 0);
  }, [canRename, changeStash, identity, initialPerson, looseParticipants, people, query]);

  const options = useMemo(() => sections.flatMap(section => section.options), [sections]);
  const visibleOptions = listOpen ? options : [];
  const activeIndex = activeKey ? visibleOptions.findIndex(option => option.key === activeKey) : -1;
  const activeOption = activeIndex >= 0 ? visibleOptions[activeIndex] : undefined;
  const listShown = visibleOptions.length > 0;
  const asking = askedWho && needsChoice;
  // While a Change search is pending the field searches, not names.
  const naming = namingOn && identity.kind === "participant" && !listOpen && !pendingSearch ? identity.participant : null;
  const hasEmailRows = options.some(option => option.kind === "new-email");
  // Enter with nothing highlighted saves; show that on the row it matches.
  const enterKey = !activeOption && identity.kind === "label" && !initialPerson ? "label" : null;

  const emailChoices =
    linkedPerson?.id && identity.kind !== "label" && identity.kind !== "new" && identity.kind !== "participant"
      ? [...new Set(participants.map(participant => participant.email.trim().toLowerCase()))]
          .filter(email => email !== linkedPerson.email?.toLowerCase() && personByEmail.get(email)?.id !== linkedPerson.id)
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
    setTypedAfterPick(true);
    if (!naming) setListOpen(true);
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
    setChangeStash(null);
    const before: Snapshot = changeStash
      ? { identity: chosenIdentity, name: changeStash.name, touched: changeStash.touched, naming: namingOn }
      : { identity: chosenIdentity, name, touched: nameTouched, naming: namingOn };
    if (option.kind === "participant" || option.kind === "new-email") {
      setBeforePick(beforePick && chosenIdentity.kind === "participant" ? beforePick : before);
      setIdentity({ kind: "participant", participant: option.participant });
      setTypedAfterPick(false);
    } else {
      setBeforePick(null);
      setNamingOn(false);
    }
    if (option.kind === "person") {
      if (initialPerson && option.person.id === initialPerson.id) setIdentity({ kind: "keep" });
      else setIdentity({ kind: "person", person: option.person });
      setName(option.person.name);
      setNameTouched(false);
    } else if (option.kind === "participant") {
      if (hasRealName(option.participant)) {
        // Their real name, never a search fragment.
        setName(option.participant.name);
        setNamingOn(false);
      } else {
        // Only an address is known: ask for a name. Typed text was part of the
        // address, a placeholder is not a name, and another person's name
        // belongs to them. Only an unlinked label is kept.
        // A name typed for the previous address carries over to this one.
        if (changeStash && namingOn && chosenIdentity.kind === "participant") setName(changeStash.name);
        else if (nameTouched || isNonName(trimmedName) || !(chosenIdentity.kind === "label" || chosenIdentity.kind === "new")) setName("");
        setNamingOn(true);
      }
      setNameTouched(true);
      selectInput();
      return;
    } else if (option.kind === "new-email") {
      // The typed name is the new person; the email is attached to them. If
      // the address turns out to be someone, Save asks rather than renaming.
      setNameTouched(true);
      setNamingOn(true);
      setTypedAfterPick(true);
    } else {
      setIdentity({ kind: option.kind });
    }
    focusInput();
  }

  // Back to how the editor was before a meeting email was chosen.
  function undoPick() {
    const before = beforePick ?? { identity: initialPerson ? { kind: "keep" } : { kind: "label" }, name: initialName, touched: false, naming: false } satisfies Snapshot;
    setIdentity(before.identity);
    setName(before.name);
    setNameTouched(before.touched);
    setNamingOn(before.naming);
    setBeforePick(null);
    setChangeStash(null);
    setLocalError(null);
    if (before.touched) setListOpen(true);
    focusInput();
  }

  // Escape after Change puts back the replaced name. Leaving the field keeps
  // anything typed so Save can ask about it, and restores only an untouched name.
  function closeList(restore: "always" | "untouched" = "untouched") {
    setListOpen(false);
    setActiveKey(null);
    if (changeStash && (restore === "always" || !nameTouched)) restoreStash();
    // A typed label needs no earlier name to fall back to.
    else if (changeStash && identity.kind === "label") setChangeStash(null);
  }

  function restoreStash() {
    if (!changeStash) return;
    setName(changeStash.name);
    setNameTouched(changeStash.touched);
    setChangeStash(null);
    setAskedWho(false);
  }

  // Select now, so typing replaces the name; retry after the commit only if
  // focus did not land (a later retry would select text already typed).
  function selectInput() {
    const select = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    select();
    if (document.activeElement !== inputRef.current) requestAnimationFrame(select);
  }

  function startChangingPerson() {
    setChangeStash(changeStash ?? { name, touched: nameTouched });
    // Search everyone; typing replaces the selected name.
    setNameTouched(false);
    setListOpen(true);
    setActiveKey(null);
    selectInput();
  }

  function unlink() {
    setIdentity({ kind: "label" });
    setNamingOn(false);
    setBeforePick(null);
    setExtraEmail(null);
    setShowEmailPicker(false);
    setLocalError(null);
    focusInput();
  }

  function keepLinkedName() {
    if (changeStash) {
      restoreStash();
      setListOpen(false);
      focusInput();
      return;
    }
    if (!linkedPerson) return;
    setName(linkedPerson.name);
    setNameTouched(false);
    setListOpen(false);
    setAskedWho(false);
    setLocalError(null);
    focusInput();
  }

  function buildDecision(): SpeakerEditDecision | string | null {
    // A new person from a bare address may stay named by that address.
    const speaker = trimmedName || (identity.kind === "participant" ? identity.participant.email : "");
    if (!speaker) return "Add a speaker name.";
    if (needsChoice) return null;
    const base = { applyTo: scope, speaker };
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
      // While naming, arrows must not open a search that could drop the email.
      if (naming) return;
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
        const restoring = Boolean(changeStash);
        closeList("always");
        if (needsChoice && !restoring) keepLinkedName();
      } else if (pendingSearch || needsChoice) {
        keepLinkedName();
      } else if (naming && beforePick) {
        // Step back from naming to where the email was chosen.
        undoPick();
      } else onCancel();
    } else if (event.key === "Backspace" && naming && !name) {
      event.preventDefault();
      startChangingPerson();
    }
  }

  const error = localError ?? serverError;
  // One persistent region, so who the speaker becomes is announced reliably.
  const announcement =
    identity.kind === "participant"
      ? `New person with ${identity.participant.email}`
      : identity.kind === "new"
        ? "New person"
        : identity.kind === "rename"
          ? `Renaming ${initialPerson?.name ?? ""} in all meetings`
          : identity.kind === "label"
            ? "No person linked"
            : linkedPerson
              ? `Linked to ${linkedPerson.name}`
              : "";

  return (
    <form
      className="w-full max-w-lg rounded-xl bg-popover p-1.5 text-popover-foreground shadow-[0_8px_30px_-12px_oklch(0.2_0.01_30/0.22)] ring-1 ring-foreground/8 dark:ring-foreground/15"
      onSubmit={submit}
    >
      <div className="flex items-center gap-1 border-b border-border/60 pb-1">
        <input
          aria-activedescendant={activeOption ? `${listId}-${activeOption.key}` : undefined}
          aria-autocomplete={naming ? undefined : "list"}
          aria-controls={listShown ? listId : undefined}
          aria-busy={isSaving}
          aria-describedby={[asking ? promptId : null, naming ? identityId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
          aria-expanded={listShown}
          aria-invalid={Boolean(error)}
          aria-label="Speaker name"
          autoComplete="off"
          autoFocus
          className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground read-only:opacity-60 sm:h-9 sm:text-sm"
          onBlur={() => closeList()}
          onChange={event => { if (!isSaving) changeName(event.target.value); }}
          onClick={() => { if (!naming) setListOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={naming ? "Add a name" : "Name or email"}
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

      <p aria-live="polite" className="sr-only">{announcement ? `Speaker: ${announcement}` : ""}</p>
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
                    <OptionContent
                      enterHint={enterKey === option.kind}
                      hasEmailRows={hasEmailRows}
                      linkedName={initialPerson?.name ?? ""}
                      option={option}
                      query={query}
                      selected={selected}
                    />
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
            id={identityId}
            identity={identity}
            initialPerson={initialPerson}
            isSaving={isSaving}
            keptName={changeStash?.name.trim() ?? ""}
            linkedPerson={linkedPerson}
            name={trimmedName}
            needsChoice={needsChoice}
            onAddEmail={() => setShowEmailPicker(true)}
            onChange={startChangingPerson}
            onKeepName={keepLinkedName}
            onUndo={() => setIdentity(initialPerson ? { kind: "keep" } : { kind: "label" })}
            onUndoPick={undoPick}
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
                {emailChoices.map(email => {
                  const owner = personByEmail.get(email);
                  return <option key={email} value={email}>{owner ? `${email} (merge into ${owner.name})` : email}</option>;
                })}
              </select>
            </label>
          ) : null}
        </>
      )}

      {error ? (
        <p className="px-2 pt-1 text-xs font-medium text-destructive" id={errorId} role="alert">{error}</p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-3 pt-1.5">
        {showScope ? (
          <div aria-label="Apply to" className="inline-flex rounded-full bg-muted/70 p-0.5" role="group">
            {([
              ["matching_speaker", "All their lines"],
              ["segment", "This line"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={scope === value}
                className={cn(
                  "relative h-8 rounded-full px-3 text-xs font-medium outline-none transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-6 sm:px-2.5 sm:before:hidden",
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
          <Button aria-label="Cancel speaker edit" className="relative h-8 before:absolute before:inset-x-0 before:-inset-y-1.5 sm:h-7 sm:before:hidden" disabled={isSaving} onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button aria-label="Save speaker" className="relative h-8 before:absolute before:inset-x-0 before:-inset-y-1.5 sm:h-7 sm:before:hidden" disabled={isSaving} size="sm" type="submit">
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
  if (option.kind === "participant") {
    return identity.kind === "participant" && identity.participant.email === option.participant.email;
  }
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

function Avatar({ name, variant = "solid" }: { name: string; variant?: "solid" | "dashed" | "empty" | "email" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium",
        (variant === "solid" || variant === "email") && "bg-foreground/[0.07] text-muted-foreground",
        variant === "dashed" && "border border-dashed border-muted-foreground/50 text-muted-foreground",
        variant === "empty" && "border border-dashed border-border",
      )}
    >
      {variant === "solid" ? initials(name) : variant === "email" ? <AtSign className="size-3" /> : variant === "dashed" ? <Plus className="size-3" /> : null}
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

function OptionContent({
  enterHint,
  hasEmailRows,
  linkedName,
  option,
  query,
  selected,
}: {
  enterHint: boolean;
  hasEmailRows: boolean;
  linkedName: string;
  option: Option;
  query: string;
  selected: boolean;
}) {
  if (option.kind === "person" || option.kind === "participant") {
    const bare = option.kind === "participant" && !hasRealName(option.participant);
    const personName = option.kind === "person" ? option.person.name : bare ? option.participant.email : option.participant.name;
    const [email, ...more] = option.kind === "person" ? option.person.emails : [option.participant.email];
    const showEmail = email && email !== personName;
    return (
      <>
        <Avatar name={personName} variant={bare ? "email" : "solid"} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={cn("max-w-[75%] shrink-0 truncate", selected && "font-medium")}>{personName}</span>
          {showEmail ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{email}{more.length ? ` +${more.length}` : ""}</span>
          ) : null}
        </span>
      </>
    );
  }
  if (option.kind === "new" || option.kind === "new-email") {
    const detail = option.kind === "new-email" ? option.participant.email : hasEmailRows ? "No email" : null;
    return (
      <>
        <Avatar name={query} variant="dashed" />
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate sm:max-w-[60%] sm:shrink-0">Create “{query}”</span>
          {detail ? (
            <span className={cn("min-w-0 break-all text-xs sm:truncate sm:break-normal", option.kind === "new-email" ? "text-foreground/80" : "text-muted-foreground")}>{detail}</span>
          ) : null}
        </span>
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
      {enterHint ? (
        <span aria-hidden="true" className="hidden items-center text-muted-foreground sm:inline-flex" title="Enter saves as a label">
          <CornerDownLeft className="size-3.5" />
        </span>
      ) : null}
    </>
  );
}

function IdentityRow({
  canAddEmail,
  id,
  identity,
  initialPerson,
  isSaving,
  keptName,
  linkedPerson,
  name,
  needsChoice,
  onAddEmail,
  onChange,
  onKeepName,
  onUndo,
  onUndoPick,
  onUnlink,
}: {
  canAddEmail: boolean;
  id: string;
  identity: Identity;
  initialPerson: SpeakerLinkedPerson | null;
  isSaving: boolean;
  keptName: string;
  linkedPerson: SpeakerLinkedPerson | null;
  name: string;
  needsChoice: boolean;
  onAddEmail: () => void;
  onChange: () => void;
  onKeepName: () => void;
  onUndo: () => void;
  onUndoPick: () => void;
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
  } else if (needsChoice && (identity.kind === "participant" || identity.kind === "new")) {
    // A Change search was typed but nothing chosen; the earlier choice stands until kept or changed.
    const who = identity.kind === "participant" ? (keptName || identity.participant.email) : keptName;
    const detail = identity.kind === "participant" ? identity.participant.email : "new person";
    groupLabel = `New person ${who}`;
    avatar = <Avatar name="" variant="dashed" />;
    body = <span className="truncate text-muted-foreground">Still {who === detail ? who : `${who}, ${detail}`}?</span>;
    actions = (
      <>
        <button aria-label={`Keep ${who}`} className={quietButton} disabled={isSaving} onClick={onKeepName} type="button">Keep</button>
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
    // The field shows the name; this row shows the email it carries.
    groupLabel = `New person ${name || identity.participant.email}`;
    avatar = <Avatar name={name} variant="dashed" />;
    body = (
      <>
        <span className="min-w-0 truncate">{identity.participant.email}</span>
        <span className="shrink-0 text-xs text-muted-foreground">New person</span>
      </>
    );
    actions = (
      <>
        {change}
        <button className={quietButton} disabled={isSaving} onClick={onUndoPick} type="button">Undo</button>
      </>
    );
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
    <div aria-label={groupLabel} className="mt-1 flex min-h-11 flex-wrap items-center gap-x-2 px-2 sm:min-h-8 sm:flex-nowrap" role={groupLabel ? "group" : undefined}>
      {avatar}
      <span className="flex min-w-[6rem] flex-1 flex-col text-sm sm:min-w-0 sm:flex-row sm:items-baseline sm:gap-2 [&>*]:max-w-full" id={id}>{body}</span>
      <span className="-mr-1 ml-auto flex shrink-0 items-center">{actions}</span>
    </div>
  );
}
