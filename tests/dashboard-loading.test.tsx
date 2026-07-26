import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "@/app/dashboard/loading";

describe("Dashboard loading state", () => {
  it("renders the page shell and layout-matched section skeletons", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-label="Loading dashboard"');
    expect(html).toContain('aria-label="Loading dashboard overview"');
    expect(html).toContain('aria-label="Loading meetings"');
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).not.toContain("<a ");
  });
});
