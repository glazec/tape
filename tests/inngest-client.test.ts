import { describe, expect, it } from "vitest";

import { buildInngestClientOptions } from "@/inngest/client";

describe("buildInngestClientOptions", () => {
  it("trims copied Inngest keys", () => {
    expect(
      buildInngestClientOptions({
        INNGEST_BASE_URL: " https://inngest.example.com\n",
        INNGEST_EVENT_KEY: "event-key\n",
        INNGEST_SIGNING_KEY: "signing-key\n",
      }),
    ).toEqual({
      id: "meeting-transcript",
      baseUrl: "https://inngest.example.com",
      eventKey: "event-key",
      signingKey: "signing-key",
    });
  });

  it("omits empty local Inngest keys", () => {
    expect(
      buildInngestClientOptions({
        INNGEST_BASE_URL: " ",
        INNGEST_EVENT_KEY: "",
        INNGEST_SIGNING_KEY: " ",
      }),
    ).toEqual({
      id: "meeting-transcript",
    });
  });
});
