import { afterEach, describe, expect, it, vi } from "vitest";

const { getTwentyCrmCompanyDomains, listMeetingParticipantTimeline, select } =
  vi.hoisted(() => ({
    getTwentyCrmCompanyDomains: vi.fn(),
    listMeetingParticipantTimeline: vi.fn(),
    select: vi.fn(),
  }));

vi.mock("@/db/client", () => ({ db: { select } }));
vi.mock("@/lib/meeting-participant-timeline", () => ({ listMeetingParticipantTimeline }));
vi.mock("@/lib/vendors/twenty", () => ({ getTwentyCrmCompanyDomains }));

const meetingId = "11111111-1111-4111-8111-111111111111";
const teamId = "22222222-2222-4222-8222-222222222222";

function mockMeeting(meeting: Record<string, unknown>) {
  const query = {
    from: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    where: () => query,
    limit: vi.fn().mockResolvedValue([meeting]),
  };
  select.mockReturnValueOnce(query);
}

function mockVocabulary(terms: Array<{ enabled: boolean; term: string }>) {
  select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        orderBy: vi.fn().mockResolvedValue(terms),
      }),
    }),
  });
}

describe("meeting vocabulary", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("sends curated terms and names relevant to the current meeting", async () => {
    mockMeeting({
      attendeeEmails: ["alex@gmail.com", "founder@events.latticeharbor.test", "team@iosg.vc"],
      botName: "Tape Notetaker",
      ownerEmail: "owner@iosg.vc",
      teamId,
      teamName: "IOSG Ventures",
      title: "Intro to Quasar with Lattice Harbor",
    });
    mockVocabulary([
      { enabled: true, term: " ZK rollups " },
      { enabled: true, term: "zk rollups" },
      { enabled: false, term: "  QUASAR  " },
    ]);
    listMeetingParticipantTimeline.mockResolvedValue([
      { name: "Mira Chen", email: "founder@events.latticeharbor.test" },
      { name: "Mira Chen", email: "founder@events.latticeharbor.test" },
      { name: "Tape Notetaker", email: null },
      { name: "alex@gmail.com", email: "alex@gmail.com" },
    ]);
    getTwentyCrmCompanyDomains.mockResolvedValue([
      { domain: "latticeharbor.test", name: "Lattice Harbor" },
      { domain: "quasar.test", name: "Quasar" },
      { domain: "harborlight.test", name: "Harborlight" },
      { domain: "roll.test", name: "Roll" },
    ]);

    const { getMeetingVocabularyKeyterms } = await import("@/lib/team-vocabulary");

    await expect(getMeetingVocabularyKeyterms(meetingId)).resolves.toEqual([
      "ZK rollups",
      "Mira Chen",
      "Lattice Harbor",
      "IOSG Ventures",
    ]);
    expect(getTwentyCrmCompanyDomains).toHaveBeenCalledWith(teamId);
    expect(listMeetingParticipantTimeline).toHaveBeenCalledWith(meetingId);
  });

  it("uses relevant company spellings from the title without an attendee domain", async () => {
    mockMeeting({
      attendeeEmails: ["alex@gmail.com", "invite@novaforge.test"],
      botName: null,
      ownerEmail: "owner@gmail.com",
      teamId,
      teamName: "Gmail workspace",
      title: "Quasar Labs / Intro",
    });
    mockVocabulary([]);
    listMeetingParticipantTimeline.mockResolvedValue([]);
    getTwentyCrmCompanyDomains.mockResolvedValue([
      { domain: "quasar.test", name: "Quasar Labs" },
      { domain: "as.test", name: "As" },
    ]);

    const { getMeetingVocabularyKeyterms } = await import("@/lib/team-vocabulary");

    await expect(getMeetingVocabularyKeyterms(meetingId)).resolves.toEqual([
      "Novaforge",
      "Quasar Labs",
    ]);
  });
});
