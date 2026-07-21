import { afterEach, describe, expect, it, vi } from "vitest";

describe("OneSignal vendor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends a location reminder to the signed in user alias", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "rest-key\n");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tape.inevitable.tech");
    vi.stubEnv(
      "NEXT_PUBLIC_ONESIGNAL_APP_ID",
      "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef\n",
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "notification_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendOneSignalLocationReminder } = await import(
      "@/lib/vendors/onesignal"
    );

    await expect(
      sendOneSignalLocationReminder({
        externalUserId: "11111111-1111-4111-8111-111111111111",
        meetingId: "22222222-2222-4222-8222-222222222222",
        meetingTitle: "Founder office visit",
        location: "IOSG 12F",
      }),
    ).resolves.toEqual({ id: "notification_123" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        Authorization: "Key rest-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef",
        target_channel: "push",
        isIos: true,
        isAndroid: true,
        isAnyWeb: true,
        include_aliases: {
          external_id: ["11111111-1111-4111-8111-111111111111"],
        },
        headings: { en: "Meeting starts soon" },
        contents: { en: "Founder office visit at IOSG 12F" },
        url: "https://tape.inevitable.tech/meetings/22222222-2222-4222-8222-222222222222/record",
      }),
    });
  });

  it("rejects OneSignal success responses with alias errors", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "rest-key\n");
    vi.stubEnv(
      "NEXT_PUBLIC_ONESIGNAL_APP_ID",
      "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef\n",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "",
            errors: {
              invalid_aliases: {
                external_id: ["11111111-1111-4111-8111-111111111111"],
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const { sendOneSignalLocationReminder } = await import(
      "@/lib/vendors/onesignal"
    );

    await expect(
      sendOneSignalLocationReminder({
        externalUserId: "11111111-1111-4111-8111-111111111111",
        meetingId: "22222222-2222-4222-8222-222222222222",
        meetingTitle: "Founder office visit",
        location: "IOSG 12F",
      }),
    ).rejects.toThrow(
      "OneSignal notification failed: invalid_aliases.external_id",
    );
  });

  it("reports HTTP, missing id, and primitive API errors", async () => {
    vi.stubEnv("ONESIGNAL_REST_API_KEY", "rest-key");
    vi.stubEnv(
      "NEXT_PUBLIC_ONESIGNAL_APP_ID",
      "117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef",
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 503,
        statusText: "Unavailable",
      }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ errors: "invalid player" }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendOneSignalLocationReminder } = await import(
      "@/lib/vendors/onesignal"
    );
    const input = {
      externalUserId: "user_1",
      meetingId: "meeting_1",
      meetingTitle: "Weekly sync",
      location: "Room 12",
    };

    await expect(sendOneSignalLocationReminder(input)).rejects.toThrow(
      "OneSignal notification failed with 503 Unavailable",
    );
    await expect(sendOneSignalLocationReminder(input)).rejects.toThrow(
      "OneSignal notification failed: missing notification id",
    );
    await expect(sendOneSignalLocationReminder(input)).rejects.toThrow(
      "OneSignal notification failed: invalid player",
    );
  });
});
