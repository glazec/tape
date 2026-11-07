// Synthetic recipient evaluation. No database writes. Add --live for provider calls.
import { buildCatalog } from "../lib/intel/provenance";
import { buildRecentPeopleBatches } from "../lib/intel/search-batches";
import { scoreIntelBatch, INTEL_SCORING_MODEL } from "../lib/intel/scoring";
import { recipientCases } from "./intel-recipient-cases";

async function main() {
  let costUsd = 0;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.ok) { const body = await response.clone().json(); costUsd += body.usage?.cost ?? 0; }
    return response;
  };
  let passed = 0;
  try {
    for (const c of recipientCases) {
      const catalog = buildCatalog(c.meetings);
      const source = c.input.kind === "content" ? c.input.text : catalog.intel.find(i => c.input.kind === "intel" && i.id === c.input.id)?.text ?? "";
      const batches = buildRecentPeopleBatches(c.meetings, catalog, c.input, { text: source });
      const people = batches.flatMap(b => b.people);
      const available = new Set(batches.flatMap(b => b.meetings.flatMap(m => m.segments.map(s => s.id))));
      const checks: Record<string, boolean> = { evidenceAvailable: [...Object.values(c.citations ?? {}), ...Object.values(c.counters ?? {})].every(id => available.has(id)) };
      const start = Date.now(); const before = costUsd;
      let ranking: unknown;
      if (process.argv.includes("--live")) {
        const matches = (await Promise.all(batches.map(b => scoreIntelBatch(b, { meetingId: "" })))).flatMap(r => r.matches).sort((a,b) => b.score - a.score);
        // Anchor by the original speaker turn, never by potentially ambiguous names.
        const personId = (anchor: string) => people.find(p => p.meetingIds.some(id => c.meetings.some(m => m.id === id && m.segments.some(s => s.id === anchor && s.speaker === p.name))))?.id;
        const match = (anchor: string) => matches.find(m => m.id === personId(anchor));
        checks.allCandidates = matches.length === people.length;
        for (const anchor of c.excluded ?? []) checks[`excluded:${anchor}`] = personId(anchor) === undefined;
        if (c.first) checks.bestRecipient = matches[0]?.id === personId(c.first) && (matches[0]?.score ?? 0) >= 50;
        for (const anchor of c.low ?? []) checks[`low:${anchor}`] = (match(anchor)?.score ?? Infinity) <= 25;
        for (const [anchor, citation] of Object.entries(c.citations ?? {})) checks[`citation:${anchor}`] = match(anchor)?.segmentIds.includes(citation) ?? false;
        for (const [anchor, citation] of Object.entries(c.counters ?? {})) checks[`counter:${anchor}`] = match(anchor)?.counterEvidenceIds.includes(citation) ?? false;
        checks.attributedCitations = matches.every(m => {
          const person = people.find(p => p.id === m.id);
          return [...m.segmentIds, ...m.counterEvidenceIds].every(id => c.meetings.some(meeting => person?.meetingIds.includes(meeting.id) && meeting.segments.some(s => s.id === id && s.speaker === person.name)));
        });
        ranking = matches.map(m => ({ ...m, name: people.find(p => p.id === m.id)!.name }));
      }
      const pass = Object.values(checks).every(Boolean);
      passed += Number(pass);
      console.log(JSON.stringify({ case: c.name, split: c.split, pass, checks, costUsd: costUsd - before, latencyMs: Date.now() - start, batches: batches.length, candidates: people.length, ranking }));
    }
  } finally { globalThis.fetch = nativeFetch; }
  console.log(JSON.stringify({ model: INTEL_SCORING_MODEL, passed, cases: recipientCases.length, totalCostUsd: costUsd, mode: process.argv.includes("--live") ? "live" : "evidence coverage only", explanationReview: "Inspect source and conflicting quotes for usefulness. The scale is inferred, quotes are original evidence." }));
  if (passed !== recipientCases.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
