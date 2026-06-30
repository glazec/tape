import Link from "next/link";
import Image from "next/image";

export type MeetingEntityLink = {
  aliases?: string[];
  normalizedValue: string;
  type: string;
  value: string;
};

const entitySections = [
  {
    label: "Organizations",
    type: "organization",
  },
  {
    label: "Money amounts",
    type: "money",
  },
  {
    label: "Names",
    type: "name",
  },
];

const organizationLogoDomains: Record<string, string> = {
  arbitrum: "arbitrum.io",
  babylon: "babylonlabs.io",
  circle: "circle.com",
  coinbase: "coinbase.com",
  github: "github.com",
  robinhood: "robinhood.com",
  slack: "slack.com",
  solana: "solana.com",
  zcash: "z.cash",
};

export function MeetingEntityLinks({
  entities,
}: {
  entities: MeetingEntityLink[];
}) {
  const sections = entitySections
    .map((section) => ({
      ...section,
      entities: entities.filter((entity) => entity.type === section.type),
    }))
    .filter((section) => section.entities.length > 0);

  if (sections.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
        Detected entities
      </p>
      <div className="mt-3 space-y-3">
        {sections.map((section) => (
          <div key={section.type}>
            <p className="text-xs font-medium text-muted-foreground">
              {section.label}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-6 text-foreground">
              {section.entities.map((entity, index) => (
                <span
                  className="inline-flex h-6 items-center gap-0.5"
                  key={`${entity.type}:${entity.normalizedValue}`}
                >
                  <Link
                    className="inline-flex h-6 items-center gap-1.5 font-medium text-foreground underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    href={getEntityDashboardHref(entity.normalizedValue)}
                  >
                    {section.type === "organization" ? (
                      <OrganizationLogo entity={entity} />
                    ) : null}
                    {entity.value}
                  </Link>
                  {index < section.entities.length - 1 ? (
                    <span className="text-muted-foreground">,</span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrganizationLogo({ entity }: { entity: MeetingEntityLink }) {
  const domain =
    getLogoDomainFromAliases(entity.aliases) ??
    organizationLogoDomains[entity.normalizedValue];

  if (!domain) {
    return null;
  }

  return (
    <Image
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-sm"
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      src={getFaviconUrl(domain)}
      unoptimized
      width={16}
    />
  );
}

function getFaviconUrl(domain: string) {
  const url = new URL("https://www.google.com/s2/favicons");

  url.searchParams.set("sz", "64");
  url.searchParams.set("domain_url", `https://${domain}`);

  return url.toString();
}

function getLogoDomainFromAliases(aliases: string[] | undefined) {
  for (const alias of aliases ?? []) {
    const domain = normalizeLogoDomain(alias);

    if (domain) {
      return domain;
    }
  }

  return null;
}

function normalizeLogoDomain(value: string) {
  const trimmed = value.trim();

  if (!trimmed || trimmed.includes("@")) {
    return null;
  }

  const candidate = trimmed.match(/^https?:\/\//i)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const hostname = new URL(candidate).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
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
