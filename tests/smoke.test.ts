import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "@/app/page";

describe("product smoke test", () => {
  it("renders the landing page shell with the primary sign in path", () => {
    const html = renderToStaticMarkup(Home());

    expect(html).toContain("Meeting Transcript");
    expect(html).toContain("Transcript queue");
    expect(html).toContain("Internal attendee access");
    expect(html).toContain('href="/auth/sign-in"');
  });
});
