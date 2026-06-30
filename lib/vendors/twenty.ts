import { z } from "zod";

import { buildTranscriptionKeyterms } from "@/lib/meeting-intelligence";

const DEFAULT_TWENTY_CRM_KEYTERM_LIMIT = 500;
const DEFAULT_TWENTY_CRM_COMPANY_DOMAIN_LIMIT = 500;

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional(),
);

const twentyEnvSchema = z.object({
  TWENTY_API_BASE_URL: optionalString,
  TWENTY_API_KEY: optionalString,
});

const fullNameSchema = z
  .object({
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
  })
  .optional()
  .nullable();

const recentCrmNamesSchema = z.object({
  data: z
    .object({
      people: z
        .object({
          edges: z
            .array(
              z.object({
                node: z.object({
                  name: fullNameSchema,
                }),
              }),
            )
            .optional()
            .default([]),
        })
        .optional(),
      companies: z
        .object({
          edges: z
            .array(
              z.object({
                node: z.object({
                  name: z.string().optional().nullable(),
                }),
              }),
            )
            .optional()
            .default([]),
        })
        .optional(),
    })
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const recentCrmCompanyDomainsSchema = z.object({
  data: z
    .object({
      companies: z
        .object({
          edges: z
            .array(
              z.object({
                node: z.object({
                  domainName: z
                    .object({
                      primaryLinkLabel: z.string().optional().nullable(),
                      primaryLinkUrl: z.string().optional().nullable(),
                    })
                    .optional()
                    .nullable(),
                  name: z.string().optional().nullable(),
                }),
              }),
            )
            .optional()
            .default([]),
        })
        .optional(),
    })
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const recentCrmNamesQuery = `query RecentCrmNames($first: Int!) {
  people(first: $first, orderBy: [{ updatedAt: DescNullsLast }]) {
    edges {
      node {
        name {
          firstName
          lastName
        }
      }
    }
  }
  companies(first: $first, orderBy: [{ updatedAt: DescNullsLast }]) {
    edges {
      node {
        name
      }
    }
  }
}`;

const recentCrmCompanyDomainsQuery = `query RecentCrmCompanyDomains($first: Int!) {
  companies(first: $first, orderBy: [{ updatedAt: DescNullsLast }]) {
    edges {
      node {
        name
        domainName {
          primaryLinkLabel
          primaryLinkUrl
        }
      }
    }
  }
}`;

export type TwentyCrmCompanyDomain = {
  domain: string;
  name: string;
};

export async function getTwentyCrmKeyterms(
  source: Record<string, string | undefined> = process.env,
) {
  const env = twentyEnvSchema.parse(source);

  if (!env.TWENTY_API_BASE_URL || !env.TWENTY_API_KEY) {
    return [];
  }

  const response = await fetch(getTwentyGraphqlUrl(env.TWENTY_API_BASE_URL), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.TWENTY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: recentCrmNamesQuery,
      variables: { first: DEFAULT_TWENTY_CRM_KEYTERM_LIMIT },
    }),
  }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const parsed = recentCrmNamesSchema.safeParse(
    await response.json().catch(() => null),
  );

  if (!parsed.success || parsed.data.errors?.length) {
    return [];
  }

  const companyNames =
    parsed.data.data?.companies?.edges
      .map(({ node }) => node.name ?? "")
      .filter(Boolean) ?? [];
  const peopleNames =
    parsed.data.data?.people?.edges
      .map(({ node }) => formatFullName(node.name))
      .filter(Boolean) ?? [];

  return buildTranscriptionKeyterms(companyNames, peopleNames);
}

export async function getTwentyCrmCompanyDomains(
  source: Record<string, string | undefined> = process.env,
): Promise<TwentyCrmCompanyDomain[]> {
  const env = twentyEnvSchema.parse(source);

  if (!env.TWENTY_API_BASE_URL || !env.TWENTY_API_KEY) {
    return [];
  }

  const response = await fetch(getTwentyGraphqlUrl(env.TWENTY_API_BASE_URL), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.TWENTY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: recentCrmCompanyDomainsQuery,
      variables: { first: DEFAULT_TWENTY_CRM_COMPANY_DOMAIN_LIMIT },
    }),
  }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const parsed = recentCrmCompanyDomainsSchema.safeParse(
    await response.json().catch(() => null),
  );

  if (!parsed.success || parsed.data.errors?.length) {
    return [];
  }

  return (
    parsed.data.data?.companies?.edges
      .map(({ node }) => {
        const name = node.name?.trim() ?? "";
        const domain = normalizeCompanyDomain(
          node.domainName?.primaryLinkUrl,
          node.domainName?.primaryLinkLabel,
        );

        return name && domain ? { domain, name } : null;
      })
      .filter((item): item is TwentyCrmCompanyDomain => Boolean(item)) ?? []
  );
}

function getTwentyGraphqlUrl(baseUrl: string) {
  const url = new URL(baseUrl);

  url.pathname = url.pathname.replace(/\/rest\/?$/, "");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/graphql`;

  return url.toString();
}

function formatFullName(name: z.infer<typeof fullNameSchema>) {
  return [name?.firstName, name?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeCompanyDomain(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();

    if (!trimmed || trimmed.includes("@")) {
      continue;
    }

    const domain = normalizeDomainCandidate(trimmed);

    if (domain) {
      return domain;
    }
  }

  return null;
}

function normalizeDomainCandidate(value: string) {
  const candidate = value.match(/^https?:\/\//i) ? value : `https://${value}`;

  try {
    const hostname = new URL(candidate).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return looksLikeDomain(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

function looksLikeDomain(value: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}
