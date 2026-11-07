import type { IntelCatalog, IntelMeeting, SearchInput } from "./types";

const segmenter = new Intl.Segmenter("en", { granularity: "word" });
const stopWords = new Set("a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my not of on or our should so that the their them there these they this to up us was we were what when where which who will with would you your 我们 你们 他们 这个 那个 就是 然后 因为 所以 一个 不是 但是 还是 现在 可能 什么 怎么 时候 可以 没有 觉得 其实".split(" "));
function terms(text: string) {
  return [...segmenter.segment(text.toLowerCase())].flatMap(part => {
    if (!part.isWordLike || stopWords.has(part.segment) || !/\p{L}/u.test(part.segment)) return [];
    const term = part.segment.normalize("NFKC").replace(/([a-z]{3,})s$/, "$1");
    return term.length > 1 ? [term] : [];
  });
}

/** Scan all authorized transcripts, then retain complete identity history for verification. */
export function retrieveSearchMeetings(corpus: IntelMeeting[], catalog: IntelCatalog, input: SearchInput, text: string, limit = 12) {
  // In a small corpus, lexical filtering only hides synonyms and other languages.
  // These are candidates for evidence verification, never automatic matches.
  if (corpus.length <= limit) return corpus;
  const selectedPeople = input.kind === "person" ? catalog.people.filter(p => input.ids.includes(p.id)) : [];
  const selectedSegments = new Set(selectedPeople.flatMap(p => p.segmentIds));
  const query = input.kind === "person"
    ? corpus.flatMap(m => m.segments.filter(s => selectedSegments.has(s.id)).map(s => s.text)).join("\n")
    : text;
  const queryCounts = new Map<string, number>();
  for (const term of terms(query)) queryCounts.set(term, (queryCounts.get(term) ?? 0) + 1);
  const documents = corpus.map(meeting => ({ meeting, terms: new Set(terms(meeting.segments.map(s => s.text).join("\n"))) }));
  const frequencies = new Map<string, number>();
  for (const document of documents) for (const term of document.terms) {
    if (queryCounts.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  const weighted = [...queryCounts].filter(([term]) => frequencies.has(term)).map(([term, count]) => ({ term,
    weight: (1 + Math.log(count)) * Math.log(1 + corpus.length / frequencies.get(term)!),
  })).sort((a, b) => b.weight - a.weight).slice(0, 24);
  const required = new Set(selectedPeople.flatMap(p => p.meetingIds));
  if (input.kind === "intel") for (const e of catalog.intel.find(i => i.id === input.id)?.evidence ?? []) required.add(e.meetingId);
  const ranked = documents.map(document => ({ meeting: document.meeting,
    score: weighted.reduce((sum, word) => sum + (document.terms.has(word.term) ? word.weight : 0), 0),
  })).filter(item => item.score > 0 && !required.has(item.meeting.id))
    .sort((a, b) => b.score - a.score || b.meeting.date.localeCompare(a.meeting.date) || a.meeting.id.localeCompare(b.meeting.id));
  const ids = new Set([...required, ...ranked.slice(0, limit).map(item => item.meeting.id)]);
  // A confirmed identity can span meetings. Never drop later contradictory evidence.
  let previousSize = -1;
  while (previousSize !== ids.size) {
    previousSize = ids.size;
    for (const person of catalog.people) {
      if (person.meetingIds.some(id => ids.has(id))) for (const id of person.meetingIds) ids.add(id);
    }
  }
  return corpus.filter(meeting => ids.has(meeting.id));
}
