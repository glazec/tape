import { expect, it } from "vitest";
import { parseIntelJson } from "@/lib/intel/json";
it.each(['{"matches":[]}', '```json\n{"matches":[]}\n```', '```\n{"matches":[]}\n```'])("parses a complete structured response", content => {
 expect(parseIntelJson(content)).toEqual({ matches: [] });
});
it.each(['{"matches":[', 'prefix {"matches":[]}', '```json\n{"matches":[]}', '```json\n{"matches":[]}\n``` extra'])("does not repair malformed or ambiguous responses", content => {
 expect(() => parseIntelJson(content)).toThrow();
});
