"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { connectionRelationshipLabels, type ConnectionChanges, type MeetingConnection } from "@/lib/meeting-connections";

export function ConnectionEditor({ connection, speakers, onSave, onReload, onClose }: {
  connection: MeetingConnection;
  speakers: Array<{ id: string; name: string }>;
  onSave: (changes: ConnectionChanges) => Promise<void>;
  onClose: () => void;
  onReload: () => Promise<MeetingConnection>;
}) {
  const [draft, setDraft] = useState<ConnectionChanges>({
    kind: connection.kind, name: connection.name, company: connection.company, title: connection.title,
    context: connection.context, relationship: connection.relationship,
    speakerSegmentId: connection.speakerSegmentId, mutual: connection.mutual ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<MeetingConnection | null>(null);
  const fieldClass = "mt-1 min-h-11 min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <DialogTitle>Edit connection</DialogTitle>
      <DialogDescription className="mt-1">Correct details or change who mentioned this connection. The original source stays available.</DialogDescription>
      <form className="mt-4 space-y-3" onSubmit={async event => {
        event.preventDefault();
        if (saving) return;
        setSaving(true); setError("");
        try { await onSave(draft); onClose(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Try again."); setConflict(Boolean(cause && typeof cause === "object" && "conflict" in cause && cause.conflict)); }
        finally { setSaving(false); }
      }}>
        <fieldset disabled={saving} className="space-y-3">
          <label className="block text-sm font-medium">Mentioned by
            <select className={fieldClass} value={draft.speakerSegmentId} onChange={event => setDraft({ ...draft, speakerSegmentId: event.target.value })}>
              {speakers.map(speaker => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(["name", "company", "title"] as const).map(field => <label key={field} className="block text-sm font-medium">
              {{ name: "Name", company: "Company", title: "Title" }[field]}
              <input className={fieldClass} maxLength={200} value={draft[field] ?? ""} onChange={event => setDraft({ ...draft, [field]: event.target.value || null })} />
            </label>)}
            <label className="block text-sm font-medium">Type
              <select className={fieldClass} value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as ConnectionChanges["kind"] })}>
                <option value="person">Person</option><option value="team">Team</option><option value="project">Project</option><option value="organization">Organization</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium">Relationship
            <select className={fieldClass} value={draft.relationship} onChange={event => setDraft({ ...draft, relationship: event.target.value as ConnectionChanges["relationship"] })}>
              {Object.entries(connectionRelationshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Description
            <textarea className={fieldClass} rows={3} required maxLength={600} value={draft.context} onChange={event => setDraft({ ...draft, context: event.target.value })} />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.mutual} onChange={event => setDraft({ ...draft, mutual: event.target.checked })} />
            Mutual connection
          </label>
        </fieldset>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {conflict ? <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={async () => {
          setSaving(true);
          try { setLatest(await onReload()); setConflict(false); setError(""); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load. Try again."); }
          finally { setSaving(false); }
        }}>Load latest version</Button> : null}
        {latest ? <div className="rounded-md border p-3 text-sm" role="status">
          <p className="font-medium">Latest saved version</p>
          <p className="mt-1 break-words">{[latest.name, latest.company, latest.title].filter(Boolean).join(" · ") || "Unnamed connection"}</p>
          <p>{connectionRelationshipLabels[latest.relationship]}{latest.mutual ? " · Mutual connection" : ""}</p>
          <p>{speakers.find(speaker => speaker.id === latest.speakerSegmentId)?.name}</p>
          <p className="mt-1 break-words">{latest.context}</p>
          <p className="mt-2 text-muted-foreground">Your draft is unchanged. Review it above, then save to replace these details.</p>
        </div> : null}
        <div className="flex justify-end gap-2">
          <Button className="min-h-11" type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" type="submit" disabled={saving || conflict || !draft.context.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
