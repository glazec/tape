import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MeetingEntityLinks } from "@/components/meeting-entity-links";

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
    expect(html).toContain("ETF");
    expect(html).toContain("20 million");
    expect(html).toContain("Darko");
    expect(html).toContain('alt=""');
    expect(html).toContain("crm-babylon.example");
    expect(html).toContain("solana.com");
    expect(html).not.toContain("babylonlabs.io");
    expect(html).not.toContain("domain_url=https%3A%2F%2Fetf");
    expect(html).toContain(
      "/dashboard?q=babylon&amp;scope=all&amp;status=all&amp;sort=smart",
    );
    expect(html).not.toContain(">Organization<");
    expect(html).not.toContain(">Money<");
    expect(html).not.toContain(">Name<");
    expect(html).not.toContain(">BA<");
    expect(html).not.toContain(">$<");
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
