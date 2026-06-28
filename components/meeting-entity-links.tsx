import Link from "next/link";

export type MeetingEntityLink = {
  normalizedValue: string;
  type: string;
  value: string;
};

export function MeetingEntityLinks({
  entities,
}: {
  entities: MeetingEntityLink[];
}) {
  if (entities.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 border-t py-4">
      <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
        Detected entities
      </p>
      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
        {entities.map((entity) => (
          <Link
            className="inline-flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md border bg-background px-2 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            href={getEntityDashboardHref(entity.normalizedValue)}
            key={`${entity.type}:${entity.normalizedValue}`}
          >
            <span className="truncate">{entity.value}</span>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {formatEntityType(entity.type)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function getEntityDashboardHref(normalizedValue: string) {
  const params = new URLSearchParams({
    q: normalizedValue,
    scope: "all",
    status: "all",
    sort: "smart",
  });

  return `/dashboard?${params.toString()}`;
}

function formatEntityType(type: string) {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
