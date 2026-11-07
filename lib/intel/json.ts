// Accept a complete Markdown wrapper, but never repair truncated or invalid JSON.
export function parseIntelJson(content: string): unknown {
  const text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : text);
}
