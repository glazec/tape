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
  });

  it("stays hidden when no displayable entities exist", () => {
    const html = renderToStaticMarkup(<MeetingEntityLinks entities={[]} />);

    expect(html).toBe("");
  });
});
