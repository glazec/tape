"use client";

import { FormEvent, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Send,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { icTeamMembers } from "@/lib/meeting-share-audiences";
import type {
  MeetingAccessPerson,
  ShareRecipient,
} from "@/lib/meeting-queries";
import type {
  ActiveMeetingShare,
  MeetingShareScope,
} from "@/lib/meeting-share-service";

type ShareDialogProps = {
  initialAccessPeople?: MeetingAccessPerson[];
  initialOrganizationShared?: boolean;
  initialShares?: ActiveMeetingShare[];
  instanceId: string;
  meetingId: string;
  showIcTeamAudience?: boolean;
  teamMembers: ShareRecipient[];
};

type ShareState = "idle" | "loading" | "success" | "error";

type SharePreview = {
  email: string;
  meetingCount: number;
  meetings: Array<{ id: string; title: string }>;
};

export function ShareDialog({
  initialAccessPeople = [],
  initialOrganizationShared = false,
  instanceId,
  initialShares = [],
  meetingId,
  showIcTeamAudience = false,
  teamMembers,
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<MeetingShareScope>("single");
  const [state, setState] = useState<ShareState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [shares, setShares] = useState<ActiveMeetingShare[]>(initialShares);
  const [organizationShared, setOrganizationShared] = useState(
    initialOrganizationShared,
  );
  const encodedMeetingId = encodeURIComponent(meetingId);
  const titleId = `${instanceId}-share-title`;
  const emailId = `${instanceId}-share-email`;
  const recipientListId = `${instanceId}-share-recipients`;

  async function loadShares() {
    const response = await fetch(`/api/meetings/${encodedMeetingId}/share`);

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as {
      organizationShared?: boolean;
      shares?: ActiveMeetingShare[];
    };
    setShares(body.shares ?? []);
    setOrganizationShared(body.organizationShared ?? false);
  }

  async function submitShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestShare(scope === "related");
  }

  async function requestShare(previewOnly: boolean) {
    setState("loading");
    setMessage(null);

    try {
      const response = await fetch(`/api/meetings/${encodedMeetingId}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          includeRelated: scope === "related",
          preview: previewOnly,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        email?: string;
        error?: string;
        futureMeetings?: boolean;
        meetingCount?: number;
        meetings?: Array<{ id: string; title: string }>;
        pending?: boolean;
      } | null;

      if (!response.ok || !body?.email) {
        setState("error");
        setMessage(body?.error ?? "Could not share this meeting.");
        return;
      }

      if (previewOnly) {
        setPreview({
          email: body.email,
          meetingCount: body.meetingCount ?? 1,
          meetings: body.meetings ?? [],
        });
        setState("idle");
        return;
      }

      setPreview(null);
      setState("success");
      setEmail("");
      setMessage(
        body.futureMeetings
          ? `Shared ${body.meetingCount ?? 1} meetings. Future related meetings are included.`
          : body.pending
            ? `Invite saved for ${body.email}.`
            : `Shared with ${body.email}.`,
      );
      await loadShares();
    } catch {
      setState("error");
      setMessage("Could not share right now. Try again.");
    }
  }

  async function revokeShare(shareId: string) {
    setState("loading");
    setMessage(null);

    const response = await fetch(
      `/api/meetings/${encodedMeetingId}/share?shareId=${encodeURIComponent(shareId)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      setState("error");
      setMessage("Could not remove access.");
      return;
    }

    setState("success");
    setMessage("Access removed.");
    await loadShares();
  }

  async function requestAudience(audience: "organization" | "ic_team") {
    setState("loading");
    setMessage(null);

    const stopOrganizationShare =
      audience === "organization" && organizationShared;
    const response = await fetch(
      stopOrganizationShare
        ? `/api/meetings/${encodedMeetingId}/share?audience=organization`
        : `/api/meetings/${encodedMeetingId}/share`,
      {
        method: stopOrganizationShare ? "DELETE" : "POST",
        ...(!stopOrganizationShare
          ? {
              body: JSON.stringify({ audience }),
              headers: { "content-type": "application/json" },
            }
          : {}),
      },
    ).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
      organizationShared?: boolean;
      recipientCount?: number;
    } | null;

    if (!response?.ok) {
      setState("error");
      setMessage(body?.error ?? "Could not update access right now.");
      return;
    }

    setState("success");
    setOrganizationShared(body?.organizationShared ?? organizationShared);
    setMessage(
      stopOrganizationShare
        ? "Organization access removed."
        : audience === "organization"
          ? "Shared with your whole organization."
          : `Shared with ${body?.recipientCount ?? icTeamMembers.length} IC team members.`,
    );
    await loadShares();
  }

  const peopleWithAccess = buildPeopleWithAccess({
    accessPeople: initialAccessPeople,
    organizationShared,
    shares,
    teamMembers,
  });

  return (
    <Card aria-labelledby={titleId} size="sm">
      <CardHeader>
        <CardTitle id={titleId}>Share</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Share this meeting with</Label>
          <div
            className={`grid gap-2 ${showIcTeamAudience ? "grid-cols-2" : "grid-cols-1"}`}
          >
            <Button
              disabled={state === "loading"}
              onClick={() => void requestAudience("organization")}
              type="button"
              variant="outline"
            >
              <Building2 data-icon="inline-start" />
              {organizationShared
                ? "Stop organization sharing"
                : "Share with organization"}
            </Button>
            {showIcTeamAudience ? (
              <Button
                disabled={state === "loading"}
                onClick={() => void requestAudience("ic_team")}
                type="button"
                variant="outline"
              >
                <Users data-icon="inline-start" />
                Share with IC team
              </Button>
            ) : null}
          </div>
          {showIcTeamAudience ? (
            <p className="text-xs leading-5 text-muted-foreground">
              IC team includes Jocy, Yiping, Frank, Mario, Jeffrey, and Turbo.
            </p>
          ) : null}
        </div>

        {preview ? (
          <SharePreviewPanel
            busy={state === "loading"}
            onBack={() => setPreview(null)}
            onConfirm={() => void requestShare(false)}
            preview={preview}
          />
        ) : (
          <form className="flex flex-col gap-3" onSubmit={submitShare}>
            <div className="flex flex-col gap-2">
              <Label htmlFor={emailId}>Colleague</Label>
              <Input
                autoComplete="email"
                className="h-10"
                id={emailId}
                list={recipientListId}
                name="email"
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  setState("idle");
                  setMessage(null);
                }}
                placeholder="Email address"
                required
                type="email"
                value={email}
              />
              <datalist id={recipientListId}>
                {teamMembers.map((member) => (
                  <option key={member.email} value={member.email}>
                    {member.name ?? member.email}
                  </option>
                ))}
              </datalist>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <input
                checked={scope === "related"}
                className="size-4"
                onChange={(event) => {
                  setScope(event.currentTarget.checked ? "related" : "single");
                  setMessage(null);
                }}
                type="checkbox"
              />
              <span>Include past and future related meetings</span>
            </label>

            <Button
              className="min-h-10 w-full"
              disabled={state === "loading"}
              type="submit"
            >
              <Send data-icon="inline-start" />
              {state === "loading"
                ? "Working…"
                : scope === "related"
                  ? "Review share"
                  : "Share meeting"}
            </Button>
          </form>
        )}

        {message ? <ShareMessage message={message} state={state} /> : null}

        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            People with access · {peopleWithAccess.length}
          </p>
          {organizationShared ? (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2">
              <Building2 className="size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Whole organization</p>
                <p className="text-xs text-muted-foreground">
                  Current and future workspace members
                </p>
              </div>
            </div>
          ) : null}
          {peopleWithAccess.length > 0 ? (
            <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {peopleWithAccess.map((person) => (
                <li
                  className="rounded-lg bg-muted/60 px-3 py-2"
                  key={person.email}
                >
                  <p className="truncate text-sm font-medium">
                    {person.name ?? person.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {person.name ? `${person.email} · ` : ""}
                    {person.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : !organizationShared ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              No one beyond the meeting owner has access yet.
            </p>
          ) : null}
        </div>

        {shares.length > 0 ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Manage manual access · {shares.length}</span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {shares.map((share) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2"
                  key={share.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{share.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {share.scope === "related" ? "Related meetings" : "This meeting"}
                      {share.pending ? " · Invite pending" : ""}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remove ${share.email}`}
                    disabled={state === "loading"}
                    onClick={() => void revokeShare(share.id)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <p className="text-xs leading-5 text-muted-foreground">
          Eligible internal participants receive access automatically. Share
          manually with external guests.
        </p>
      </CardContent>
    </Card>
  );
}

function buildPeopleWithAccess({
  accessPeople,
  organizationShared,
  shares,
  teamMembers,
}: {
  accessPeople: MeetingAccessPerson[];
  organizationShared: boolean;
  shares: ActiveMeetingShare[];
  teamMembers: ShareRecipient[];
}) {
  const people = new Map<
    string,
    { detail: string; email: string; name: string | null }
  >();
  const knownPeople = new Map(
    [...teamMembers, ...icTeamMembers].map((person) => [person.email, person]),
  );

  for (const person of accessPeople) {
    people.set(person.email, { ...person, detail: "Meeting participant" });
  }

  for (const share of shares) {
    const knownPerson = knownPeople.get(share.email);

    people.set(share.email, {
      detail: share.pending
        ? "Invite pending"
        : share.scope === "related"
          ? "Related meetings"
          : "This meeting",
      email: share.email,
      name: knownPerson?.name ?? people.get(share.email)?.name ?? null,
    });
  }

  if (organizationShared) {
    for (const member of teamMembers) {
      const existing = people.get(member.email);

      people.set(member.email, {
        email: member.email,
        name: member.name,
        detail: existing?.detail ?? "Organization member",
      });
    }
  }

  return Array.from(people.values()).sort((left, right) =>
    (left.name ?? left.email).localeCompare(right.name ?? right.email),
  );
}

function SharePreviewPanel({
  busy,
  onBack,
  onConfirm,
  preview,
}: {
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
  preview: SharePreview;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold">
          Share {preview.meetingCount} meeting{preview.meetingCount === 1 ? "" : "s"}?
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Future related meetings will also be shared with {preview.email}.
        </p>
      </div>
      {preview.meetings.length > 0 ? (
        <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg bg-muted/60 p-3 text-xs">
          {preview.meetings.map((meeting) => (
            <li className="truncate" key={meeting.id}>
              {meeting.title}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={onBack} type="button" variant="outline">
          Back
        </Button>
        <Button disabled={busy} onClick={onConfirm} type="button">
          {busy ? "Sharing…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}

function ShareMessage({
  message,
  state,
}: {
  message: string;
  state: ShareState;
}) {
  const failed = state === "error";

  return (
    <div
      aria-live="polite"
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-5 ${
        failed
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-foreground"
      }`}
      role={failed ? "alert" : "status"}
    >
      {failed ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{message}</span>
    </div>
  );
}
