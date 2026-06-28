import type { MeetingAccessPerson } from "@/lib/meeting-queries";

type MeetingAccessSummaryProps = {
  accessPeople: MeetingAccessPerson[];
  accessScope: "workspace" | "shared";
};

export function MeetingAccessSummary({
  accessPeople,
  accessScope,
}: MeetingAccessSummaryProps) {
  if (accessScope === "workspace") {
    return <p className="text-sm font-semibold">Organization</p>;
  }

  return (
    <div className="text-sm">
      <p className="font-semibold">{formatSharedAccessLabel(accessPeople)}</p>
      {accessPeople.length > 0 ? (
        <ul
          aria-label="People with access"
          className="mt-2 flex flex-col gap-1 text-muted-foreground"
        >
          {accessPeople.map((person) => (
            <li className="truncate" key={person.email} title={person.email}>
              {formatAccessPerson(person)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatSharedAccessLabel(accessPeople: MeetingAccessPerson[]) {
  if (accessPeople.length === 0) {
    return "Shared with you";
  }

  return `Shared with ${accessPeople.length} ${
    accessPeople.length === 1 ? "person" : "people"
  }`;
}

function formatAccessPerson(person: MeetingAccessPerson) {
  const name = person.name?.trim();

  return name ? `${name} (${person.email})` : person.email;
}
