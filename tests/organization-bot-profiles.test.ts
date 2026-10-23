import { afterEach, describe, expect, it, vi } from "vitest";
const { select, insert, update } = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select, insert, update } }));
import { getCalendarMeetingBotProfile, getMeetingBotProfile, upsertMeetingBotProfile } from "@/lib/meeting-bot-profile";
function rows(value: unknown[]) { return { from: () => ({ where: () => ({ limit: async () => value }) }) }; }
afterEach(() => vi.clearAllMocks());
describe("organization bot profiles", () => {
  it("uses the preferred organization's bot for both calendar copies", async () => {
    const profile = { botName: "IOSF Old Friend", avatarJpegBase64: "preferred-avatar" };
    select.mockReturnValueOnce(rows([{ preferredBotDomain: "iosf.vc" }])).mockReturnValueOnce(rows([profile]));
    const first = await getCalendarMeetingBotProfile({ teamId: "company", accountDomain: "iosg.vc", attendeeEmails: ["a@iosg.vc", "b@iosf.vc"] });
    select.mockReturnValueOnce(rows([{ preferredBotDomain: "iosf.vc" }])).mockReturnValueOnce(rows([profile]));
    const second = await getCalendarMeetingBotProfile({ teamId: "company", accountDomain: "iosf.vc", attendeeEmails: ["b@iosf.vc", "a@iosg.vc"] });
    expect(first).toEqual(profile);
    expect(second).toEqual(first);
  });
  it("uses the invited organization's avatar when the preferred organization is absent", async () => {
    select.mockReturnValueOnce(rows([{ preferredBotDomain: "iosf.vc" }]))
      .mockReturnValueOnce(rows([{ domain: "iosg.vc" }]))
      .mockReturnValueOnce(rows([{ botName: "IOSG Old Friend", avatarJpegBase64: "first-avatar" }]));
    expect(await getCalendarMeetingBotProfile({ teamId: "company", attendeeEmails: ["a@iosg.vc", "guest@external.test"] }))
      .toEqual({ botName: "IOSG Old Friend", avatarJpegBase64: "first-avatar" });
  });
  it("falls back to the existing team profile for an organization without a custom profile", async () => {
    select.mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([{ botName: "Legacy Friend", avatarJpegBase64: "legacy" }]));
    expect(await getMeetingBotProfile("company", "iosg.vc")).toEqual({ botName: "Legacy Friend", avatarJpegBase64: "legacy" });
  });
  it("stores each organization's avatar under its own domain", async () => {
    const values = vi.fn((value: { domain: string; avatarJpegBase64?: string }) => { void value; return { onConflictDoUpdate: vi.fn() }; });
    insert.mockReturnValue({ values });
    for (const domain of ["iosg.vc", "iosf.vc"]) {
      await upsertMeetingBotProfile({ teamId: "company", domain, botName: domain,
        avatarFile: new File([domain], "avatar.jpg", { type: "image/jpeg" }) });
    }
    expect(values.mock.calls.map(([value]) => value.domain)).toEqual(["iosg.vc", "iosf.vc"]);
    expect(values.mock.calls[0][0].avatarJpegBase64).not.toBe(values.mock.calls[1][0].avatarJpegBase64);
    expect(update).not.toHaveBeenCalled();
  });
});
