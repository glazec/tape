"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function OrganizationSwitcher() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<{ teamId: string; teamName: string }[]>([]);
  const [teamId, setTeamId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/organizations").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (active) { setOrganizations(body.organizations); setTeamId(body.teamId); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (organizations.length < 2) return null;
  return (
    <div>
      <select
        aria-label="Organization"
        className="min-h-9 max-w-48 rounded-md border bg-background px-2 text-sm"
        disabled={saving}
        value={teamId}
        onChange={async (event) => {
          const nextTeamId = event.target.value;
          setSaving(true); setError(false);
          try {
            const response = await fetch("/api/organizations", {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamId: nextTeamId }),
            });
            if (!response.ok) throw new Error("Organization unavailable");
            setTeamId(nextTeamId);
            // Leave meeting-specific forms before changing the creation context.
            router.push("/dashboard"); router.refresh();
          } catch { setError(true); }
          finally { setSaving(false); }
        }}
      >
        {organizations.map((organization) => <option key={organization.teamId} value={organization.teamId}>{organization.teamName}</option>)}
      </select>
      {error ? <p role="alert" className="text-sm text-destructive">Organization could not be changed.</p> : null}
    </div>
  );
}
