// Optional live check using synthetic statements only. No database writes.
import { INTEL_VERIFIER_MODEL, verifyIntelClaims } from "../lib/intel/verification";
const evidence = [
  { id: "s1", speaker: "Alex", text: "I am not interested in GPUs. My colleague Ben researches GPUs.", date: "2026-11-01" },
  { id: "s2", speaker: "Maya", text: "We spent $80,000 on inference in September. This is our total cloud inference bill for that month.", date: "2026-10-01" },
  { id: "s3", speaker: "Maya", text: "We plan to enter Japan next quarter. We have not launched there yet.", date: "2026-10-01" },
  { id: "s4", speaker: "Alex", text: "We were looking for GPU suppliers in June.", date: "2026-06-01" },
];
const claims = [
  { text: "Alex committed $50 million to GPUs.", segmentIds: ["s1"] },
  { reason: "Alex is interested in GPUs.", relevance: "expressed_interest", segmentIds: ["s1"] },
  { text: "Maya's team spent $80,000 on cloud inference in September.", segmentIds: ["s2"] },
  { text: "Maya's team spends $80,000 every month on inference.", segmentIds: ["s2"] },
  { text: "Maya's team has launched in Japan.", segmentIds: ["s3"] },
  { text: "Maya's team plans to enter Japan next quarter.", segmentIds: ["s3"] },
  { text: "Alex researches GPUs.", segmentIds: ["s1"] },
  { reason: "Alex currently wants GPU suppliers.", relevance: "expressed_interest", caveat: "", segmentIds: ["s4"], counterEvidenceIds: [] },
];
async function main() {
const supported = await verifyIntelClaims(claims, evidence, "");
const expected = new Set([2, 5]);
const actual = new Set(supported.map(claim => claims.indexOf(claim)));
const correct = claims.filter((_, index) => expected.has(index) === actual.has(index)).length;
console.log(JSON.stringify({ model: INTEL_VERIFIER_MODEL, cases: claims.length, correct, accepted: [...actual], expected: [...expected] }));
if (correct !== claims.length) process.exitCode = 1;

}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
