import { describe, expect, it } from "vitest";
import {
  applySpeakerAliasesToSegments,
  buildTeamSpeakerAliasRows,
  resolveParticipantSpeakerAliases,
} from "@/lib/speaker-alias-normalization";

describe("remembered speaker identities", () => {
  const aliases = [{ alias: "yiping@iosf.vc", canonicalName: "Yiping" }];
  it("matches the complete email case insensitively, never another domain or a name", () => {
    expect(
      applySpeakerAliasesToSegments(
        [
          { speaker: "YIPING@IOSF.VC" },
          { speaker: "yiping@another.vc" },
          { speaker: "yiping" },
        ],
        aliases,
      ),
    ).toEqual([
      { speaker: "Yiping" },
      { speaker: "yiping@another.vc" },
      { speaker: "yiping" },
    ]);
  });
  it("persists only email identities, never a generic speaker or common name", () => {
    expect(
      buildTeamSpeakerAliasRows({
        teamId: "team",
        canonicalName: "Yiping",
        aliases: ["Speaker 1", "Yiping", "yiping@iosf.vc"],
      }),
    ).toEqual([
      {
        teamId: "team",
        canonicalName: "Yiping",
        alias: "yiping@iosf.vc",
        aliasKey: "email:yiping@iosf.vc",
      },
    ]);
  });
});

describe("participant identity resolution", () => {
  const aliases = [{ alias: "yiping@iosf.vc", canonicalName: "Yiping" }];
  it("applies remembered names to a verified participant display name", () => {
    const resolved = resolveParticipantSpeakerAliases(aliases, [
      { name: "Yiping Zhang", email: "YIPING@IOSF.VC" },
    ]);
    expect(
      applySpeakerAliasesToSegments([{ speaker: "Yiping Zhang" }], resolved),
    ).toEqual([{ speaker: "Yiping" }]);
  });
  it("does not infer a person from shared names, missing emails or generic speakers", () => {
    expect(
      resolveParticipantSpeakerAliases(aliases, [
        { name: "Yiping.Zhang", email: "yiping@iosf.vc" },
        { name: "Yiping Zhang", email: "someone@other.vc" },
        { name: "Speaker 1", email: "yiping@iosf.vc" },
        { name: "Yiping", email: null },
        { name: "Yiping", email: "yiping@iosf.vc" },
      ]),
    ).toEqual(aliases);
  });
});
