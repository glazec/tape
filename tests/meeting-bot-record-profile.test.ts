import { beforeEach, describe, expect, it, vi } from "vitest";
const { select, getMeetingBotProfile, getCalendarMeetingBotProfile } = vi.hoisted(() => ({ select: vi.fn(), getMeetingBotProfile: vi.fn(), getCalendarMeetingBotProfile: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select } }));
vi.mock("@/lib/meeting-bot-profile", () => ({ getMeetingBotProfile, getCalendarMeetingBotProfile }));
import { getBotProfileForMeeting } from "@/lib/meeting-bot-record-profile";
function row(value: unknown) {
  const query = { leftJoin: vi.fn(), where: vi.fn(() => ({ limit: async () => value ? [value] : [] })) };
  query.leftJoin.mockReturnValue(query);
  select.mockReturnValue({ from: () => query });
}
beforeEach(() => vi.resetAllMocks());
describe("existing meeting bot identity", () => {
  it("retains the selected bot on retry even when calendar attendees prefer another", async () => {
    row({ teamId: "company", organizationDomain: "second.test", attendeeEmails: ["first@first.test"], accountEmail: "first@first.test" });
    getMeetingBotProfile.mockResolvedValue({ botName: "Second bot", avatarJpegBase64: "second-avatar" });
    expect(await getBotProfileForMeeting("meeting")).toEqual({ botName: "Second bot", avatarJpegBase64: "second-avatar" });
    expect(getMeetingBotProfile).toHaveBeenCalledWith("company", "second.test");
    expect(getCalendarMeetingBotProfile).not.toHaveBeenCalled();
  });
  it("keeps the attendee preference and connected account for calendar-created meetings", async () => {
    row({ teamId: "company", organizationDomain: null, attendeeEmails: ["first@first.test"], accountEmail: "second@second.test" });
    await getBotProfileForMeeting("meeting");
    expect(getCalendarMeetingBotProfile).toHaveBeenCalledWith({ teamId: "company", attendeeEmails: ["first@first.test"], accountDomain: "second.test" });
  });
});
