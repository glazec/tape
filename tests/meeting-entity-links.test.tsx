import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MeetingEntityLinks } from "@/components/meeting-entity-links";

describe("MeetingEntityLinks", () => {
  it("links detected entities to matching dashboard search", () => {
    const html = renderToStaticMarkup(
      <MeetingEntityLinks
        entities={[
          {
            normalizedValue: "nascent",
            type: "organization",
            value: "Nascent",
          },
        ]}
      />,
    );

    expect(html).toContain("Detected entities");
    expect(html).toContain("Nascent");
    expect(html).toContain("Organization");
    expect(html).toContain(
      "/dashboard?q=nascent&amp;scope=all&amp;status=all&amp;sort=smart",
    );
    expect(html).toContain(">N<");
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
    expect(html).toContain("Name");
    expect(html).toContain("20 million");
    expect(html).toContain("Money");
    expect(html).toContain(">$<");
  });

  it("stays hidden when no displayable entities exist", () => {
    const html = renderToStaticMarkup(<MeetingEntityLinks entities={[]} />);

    expect(html).toBe("");
  });
});
