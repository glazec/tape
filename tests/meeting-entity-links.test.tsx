import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getLogoDomainsForEntity,
  MeetingEntityLinks,
} from "@/components/meeting-entity-links";

describe("MeetingEntityLinks", () => {
  it("groups detected entities as text links by category", () => {
    const html = renderToStaticMarkup(
      <MeetingEntityLinks
        entities={[
          {
            normalizedValue: "darko",
            type: "name",
            value: "Darko",
          },
          {
            normalizedValue: "20 million",
            type: "money",
            value: "20 million",
          },
          {
            aliases: ["crm-babylon.example"],
            normalizedValue: "babylon",
            type: "organization",
            value: "Babylon",
          },
          {
            normalizedValue: "solana",
            type: "organization",
            value: "Solana",
          },
          {
            normalizedValue: "revolut",
            type: "organization",
            value: "Revolut",
          },
          {
            normalizedValue: "stripe",
            type: "organization",
            value: "Stripe",
          },
          {
            normalizedValue: "surf ai",
            type: "organization",
            value: "Surf AI",
          },
          {
            normalizedValue: "etf",
            type: "organization",
            value: "ETF",
          },
        ]}
      />,
    );

    expect(html).toContain("Detected entities");
    expect(html.indexOf("Organizations")).toBeLessThan(html.indexOf("Money"));
    expect(html.indexOf("Money")).toBeLessThan(html.indexOf("Names"));
    expect(html).toContain("Babylon");
    expect(html).toContain("Solana");
    expect(html).toContain("Revolut");
    expect(html).toContain("Stripe");
    expect(html).toContain("Surf AI");
    expect(html).toContain("ETF");
    expect(html).toContain("20 million");
    expect(html).toContain("Darko");
    expect(html).toContain('alt=""');
    expect(html).toContain("/api/favicons?domain=crm-babylon.example");
    expect(html).toContain("crm-babylon.example");
    expect(html).toContain("solana.com");
    expect(html).toContain("revolut.com");
    expect(html).toContain("stripe.com");
    expect(html).toContain("surfai.com");
    expect(html).not.toContain("babylonlabs.io");
    expect(html).not.toContain("domain_url=https%3A%2F%2Fetf");
    expect(html).toContain("flex flex-wrap items-center");
    expect(html).toContain("inline-flex h-6 items-center");
    expect(html).toContain(
      "/dashboard?q=babylon&amp;scope=all&amp;status=all&amp;sort=smart",
    );
    expect(html).not.toContain(">Organization<");
    expect(html).not.toContain(">Money<");
    expect(html).not.toContain(">Name<");
    expect(html).not.toContain(">BA<");
    expect(html).not.toContain(">$<");
  });

  it("uses CRM domains before curated domains and guessed suffixes", () => {
    expect(
      getLogoDomainsForEntity({
        aliases: ["https://crm-babylon.example/company/babylon"],
        normalizedValue: "babylon",
        type: "organization",
        value: "Babylon",
      }),
    ).toEqual([
      "crm-babylon.example",
      "babylonlabs.io",
      "babylon.com",
      "babylon.io",
      "babylon.xyz",
      "babylon.org",
      "babylon.ai",
    ]);
  });

  it("guesses common domain suffixes for organizations without CRM domains", () => {
    expect(
      getLogoDomainsForEntity({
        normalizedValue: "surf ai",
        type: "organization",
        value: "Surf AI",
      }),
    ).toEqual([
      "surfai.com",
      "surfai.io",
      "surfai.xyz",
      "surfai.org",
      "surfai.ai",
    ]);
  });

  it("uses ethereum.org before guessed suffixes for Ethereum", () => {
    expect(
      getLogoDomainsForEntity({
        normalizedValue: "ethereum",
        type: "organization",
        value: "Ethereum",
      }),
    ).toEqual([
      "ethereum.org",
      "ethereum.com",
      "ethereum.io",
      "ethereum.xyz",
      "ethereum.ai",
    ]);
  });

  it("renders name and money entities on the detail page", () => {
    const html = renderToStaticMarkup(
      <MeetingEntityLinks
        entities={[
          {
            normalizedValue: "darko",
            type: "name",
            value: "Darko",
          },
          {
            normalizedValue: "20 million",
            type: "money",
            value: "20 million",
          },
        ]}
      />,
    );

    expect(html).toContain("Darko");
    expect(html).toContain("Names");
    expect(html).toContain("20 million");
    expect(html).toContain("Money");
    expect(html).not.toContain(">Name<");
    expect(html).not.toContain(">$<");
  });

  it("stays hidden when no displayable entities exist", () => {
    const html = renderToStaticMarkup(<MeetingEntityLinks entities={[]} />);

    expect(html).toBe("");
  });
});
