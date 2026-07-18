import type { MeetingAccessPerson } from "@/lib/meeting-queries";

type MeetingAccessSummaryProps = {
  accessPeople: MeetingAccessPerson[];
  accessScope: "workspace" | "shared";
  organizationShared?: boolean;
};

export function MeetingAccessSummary({
  accessPeople,
  accessScope,
  organizationShared = false,
}: MeetingAccessSummaryProps) {
  const label =
    accessScope === "workspace"
      ? organizationShared
        ? "Shared with organization"
        : formatManagedAccessLabel(accessPeople)
      : "Shared with you";

  return (
    <div className="text-sm">
      <p className="font-semibold">{label}</p>
    </div>
  );
}

function formatManagedAccessLabel(accessPeople: MeetingAccessPerson[]) {
  if (accessPeople.length === 0) {
    return "Not shared beyond participants";
  }

  return `You and ${accessPeople.length} ${
    accessPeople.length === 1 ? "person" : "people"
  }`;
}
