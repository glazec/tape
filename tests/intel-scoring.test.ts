import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scoreIntelBatch } from "@/lib/intel/scoring";
const usage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/provider-usage", () => ({ recordOpenRouterCompletionUsage: usage }));
const fetchDecision = vi.fn();
const batch = {
 input: {kind:"content" as const,text:"GPU capacity"}, source:{text:"GPU capacity"}, intel:[], selectedPeople:[],
 people:[{id:"alex",name:"Alex",kind:"participant" as const,detail:"Meeting",meetingIds:["m"],segmentIds:["s"],sourceDate:"2026-11-06",sourceMeetingId:"m",sourceSegmentId:"s"}],
 meetings:[{id:"m",title:"Meeting",date:"2026-11-06",notes:null,followup:null,segments:[{id:"s",speaker:"Alex",text:"I need GPUs",startMs:0},{id:"other",speaker:"Bob",text:"I sell GPUs",startMs:1}]}],
};
function response(score = 3.2) {
 return {id:"gen-1",model:"typesafe/jev-1.14",usage:{cost:0.001,input_tokens:1000,output_tokens:30},answers:{
  p0_score:{type:"score",score},p0_relevance:{type:"choice",choice:"expressed_interest"},
  p0_evidence:{type:"choice",choice:"s"},p0_counter:{type:"choice",choice:"none"},
 }};
}
beforeEach(()=>{vi.stubEnv("OPENROUTER_API_KEY","test");vi.stubGlobal("fetch",fetchDecision);fetchDecision.mockResolvedValue(Response.json(response()));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
it("calls Jev decisions directly, maps its ordered score to 100 and records actual usage",async()=>{
 const result=await scoreIntelBatch(batch,{meetingId:"m",searchId:"search"});
 expect(result.matches[0]).toMatchObject({id:"alex",score:80,segmentIds:["s"],counterEvidenceIds:[]});
 const [url,init]=fetchDecision.mock.calls[0];const body=JSON.parse(init.body);
 expect(url).toBe("https://openrouter.ai/api/alpha/decisions");expect(body.model).toBe("typesafe/jev-1.14");
 expect(body.questions.p0_score.type).toBe("score");expect(body.questions.p0_score.criteria).toHaveLength(5);
 expect(Object.keys(body.questions.p0_evidence.criteria)).toEqual(["s"]);
 expect(usage).toHaveBeenCalledWith(expect.objectContaining({generationId:"gen-1",operation:"decisions",metadata:{intelSearchId:"search"}}));
});
it("retains zero scores instead of applying a probability cutoff",async()=>{
 fetchDecision.mockResolvedValue(Response.json(response(0)));
 expect((await scoreIntelBatch(batch,{meetingId:"m"})).matches[0].score).toBe(0);
});
it("rejects invalid scores, missing answers and evidence outside the target identity",async()=>{
 for(const change of [ {p0_score:{type:"score",score:4.1}}, {p0_evidence:{type:"choice",choice:"other"}}, {p0_counter:undefined} ]){
  const value=response();Object.assign(value.answers,change);fetchDecision.mockResolvedValue(Response.json(value));
  await expect(scoreIntelBatch(batch,{meetingId:"m"})).rejects.toThrow();
 }
});
it("selects evidence for the source person and retains dated counter evidence",async()=>{
 const selected={...batch.people[0],id:"bob",name:"Bob",segmentIds:["other"],sourceSegmentId:"other"};
 const value={...response(),answers:{...response().answers,p0_source:{type:"choice",choice:"other"},p0_counter:{type:"choice",choice:"s"}}};
 fetchDecision.mockResolvedValue(Response.json(value));
 const result=await scoreIntelBatch({...batch,input:{kind:"person",ids:["bob"]},selectedPeople:[selected]},{meetingId:"m"});
 expect(result.matches[0].segmentIds).toEqual(["s","other"]);expect(result.matches[0].counterEvidenceIds).toEqual(["s"]);
});
it("fails visibly on provider rejection without exposing the response body",async()=>{
 fetchDecision.mockResolvedValue(new Response("private provider detail",{status:403}));
 await expect(scoreIntelBatch(batch,{meetingId:"m"})).rejects.toThrow("Jev scoring failed (HTTP 403)");
});
it("uses attributed mention evidence when the selected input is a mentioned contact",async()=>{
 const selected={...batch.people[0],id:"contact",name:"Charlie",kind:"mentioned" as const,segmentIds:["other"],sourceSegmentId:"other"};
 fetchDecision.mockResolvedValue(Response.json({...response(),answers:{...response().answers,p0_source:{type:"choice",choice:"other"}}}));
 const result=await scoreIntelBatch({...batch,input:{kind:"person",ids:["contact"]},selectedPeople:[selected]},{meetingId:"m"});
 expect(result.matches[0].segmentIds).toEqual(["s","other"]);
});
it("shows the selected original passage and dated contradiction without another model call", async () => {
 const value=response();value.answers.p0_counter.choice="s";
 fetchDecision.mockResolvedValue(Response.json(value));
 const result=await scoreIntelBatch(batch,{meetingId:"m"});
 expect(result.matches[0].reason).toContain('“I need GPUs” (2026-11-06)');
 expect(result.matches[0].caveat).toContain('“I need GPUs” (2026-11-06)');
 expect(fetchDecision).toHaveBeenCalledTimes(1);
});
it("limits evidence choices to identity membership when display names match",async()=>{
 const sameName={...batch,meetings:[{...batch.meetings[0],segments:batch.meetings[0].segments.map(s=>({...s,speaker:"Alex"}))}]};
 await scoreIntelBatch(sameName,{meetingId:"m"});
 const body=JSON.parse(fetchDecision.mock.calls[0][1].body);
 expect(Object.keys(body.questions.p0_evidence.criteria)).toEqual(["s"]);
 expect(Object.keys(body.questions.p0_counter.criteria)).toEqual(["none","s"]);
});
it("offers at most sixty newest substantive passages so Jev's option and token limits hold", async () => {
 const segments = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, speaker: "Alex", text: i % 2 ? "Yes." : `We need more GPU capacity, update ${i}`, startMs: i }));
 const big = { ...batch, people: [{ ...batch.people[0], segmentIds: segments.map(s => s.id) }], meetings: [{ ...batch.meetings[0], segments }] };
 const value = response(); value.answers.p0_evidence.choice = "s298";
 fetchDecision.mockResolvedValue(Response.json(value));
 await scoreIntelBatch(big, { meetingId: "m" });
 const body = JSON.parse(fetchDecision.mock.calls[0][1].body);
 const keys = Object.keys(body.questions.p0_evidence.criteria);
 expect(keys).toHaveLength(60);
 expect(keys[0]).toBe("s298");
 expect(keys.every(k => Number(k.slice(1)) % 2 === 0)).toBe(true);
 expect(Object.keys(body.questions.p0_counter.criteria)).toHaveLength(61);
 expect(body.questions.p0_evidence.criteria.s298).toBe("Alex, 2026-11-06");
});
it("types Jev size refusals so the caller can split the batch", async () => {
 const { JevRequestTooLargeError } = await import("@/lib/intel/tokens");
 fetchDecision.mockResolvedValue(new Response(JSON.stringify({ detail: { error_type: "max_tokens_exceeded" } }), { status: 400 }));
 await expect(scoreIntelBatch(batch, { meetingId: "m" })).rejects.toBeInstanceOf(JevRequestTooLargeError);
 fetchDecision.mockResolvedValue(new Response(JSON.stringify({ detail: [{ type: "too_long" }] }), { status: 422 }));
 await expect(scoreIntelBatch(batch, { meetingId: "m" })).rejects.toBeInstanceOf(JevRequestTooLargeError);
 fetchDecision.mockResolvedValue(new Response("private provider detail", { status: 400 }));
 await expect(scoreIntelBatch(batch, { meetingId: "m" })).rejects.toThrow("Jev scoring failed (HTTP 400)");
});
it("offers filler only when a person said nothing more substantive", async () => {
 const segments = [{ id: "f1", speaker: "Alex", text: "好。", startMs: 0 }, { id: "f2", speaker: "Alex", text: "啊，那我去找找。", startMs: 1 }, { id: "real", speaker: "Alex", text: "我们下个月需要两百张卡做推理", startMs: 2 }, { id: "en", speaker: "Alex", text: "We need GPUs.", startMs: 3 }, { id: "ok", speaker: "Alex", text: "Sounds good.", startMs: 4 }];
 const withReal = { ...batch, people: [{ ...batch.people[0], segmentIds: segments.map(s => s.id) }], meetings: [{ ...batch.meetings[0], segments }] };
 const value = response(); value.answers.p0_evidence.choice = "real";
 fetchDecision.mockResolvedValue(Response.json(value));
 await scoreIntelBatch(withReal, { meetingId: "m" });
 expect(Object.keys(JSON.parse(fetchDecision.mock.calls[0][1].body).questions.p0_evidence.criteria).sort()).toEqual(["en", "real"]);
 const filler = { ...batch, people: [{ ...batch.people[0], segmentIds: ["f1", "f2"] }], meetings: [{ ...batch.meetings[0], segments: segments.slice(0, 2) }] };
 const value2 = response(); value2.answers.p0_evidence.choice = "f2";
 fetchDecision.mockResolvedValue(Response.json(value2));
 await scoreIntelBatch(filler, { meetingId: "m" });
 expect(Object.keys(JSON.parse(fetchDecision.mock.calls[1][1].body).questions.p0_evidence.criteria).sort()).toEqual(["f1", "f2"]);
});
