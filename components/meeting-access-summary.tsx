import type { MeetingAccessPerson } from "@/lib/meeting-queries";

type MeetingAccessSummaryProps = {
  accessPeople: MeetingAccessPerson[];
  accessScope: "workspace" | "shared";
};

export function MeetingAccessSummary({
  accessPeople,
  accessScope,
}: MeetingAccessSummaryProps) {
  const label =
    accessScope === "workspace"
      ? formatManagedAccessLabel(accessPeople)
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
