import { beforeEach, describe, expect, it, vi } from "vitest";
const {execute} = vi.hoisted(() => ({execute:vi.fn()}));
vi.mock("@/db/client", () => ({db:{execute}}));
import { attachSpeakerIdentities, mutateSpeakerIdentity, speakerUpdateSchema } from "@/lib/speaker-identity";
const segmentId="11111111-1111-4111-8111-111111111111";
describe("speaker identity service", () => {
  beforeEach(()=>execute.mockReset());
  it("requires an anchor and revision for explicit identity changes",()=>{
    expect(speakerUpdateSchema.safeParse({speaker:"Alex",linkAction:"create"}).success).toBe(false);
    expect(speakerUpdateSchema.safeParse({speaker:"Alex",linkAction:"create",segmentId,expectedRevision:0}).success).toBe(true);
    expect(speakerUpdateSchema.safeParse({speaker:"Alex",linkAction:"link",segmentId,expectedRevision:0}).success).toBe(false);
  });
  it("allows name-only creation and does not infer identity from names",async()=>{
    execute.mockResolvedValue({rows:[{result:{updated:true,segments:[],person:{id:segmentId,name:"Alex",emails:[]}}}]});
    expect((await mutateSpeakerIdentity(segmentId,{speaker:"Alex",linkAction:"create",segmentId,expectedRevision:0,applyTo:"matching_speaker"})).person?.emails).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("preserves legacy mocks without querying and keeps raw source",async()=>{
    expect(await attachSpeakerIdentities(segmentId,[{id:segmentId,speaker:"Speaker 1"}])).toEqual([{id:segmentId,speaker:"Speaker 1",sourceSpeaker:"Speaker 1",personId:null,participantEmail:null,speakerRevision:0}]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("projects persisted identity while preserving unrelated segment fields",async()=>{
    execute.mockResolvedValue({rows:[{id:segmentId,speaker:"Alice Q",sourceSpeaker:"Speaker 1",personId:"person",meetingSpeakerId:"group",participantEmail:null,speakerRevision:2}]});
    expect((await attachSpeakerIdentities(segmentId,[{id:segmentId,speaker:"Speaker 1",meetingSpeakerId:"group",text:"Original"}]))[0]).toMatchObject({speaker:"Alice Q",sourceSpeaker:"Speaker 1",personId:"person",text:"Original"});
  });
});
