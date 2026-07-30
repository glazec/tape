import { FAQ_ITEMS } from "@/components/landing/faq-items";
import { REPOSITORY_URL, siteUrl } from "@/lib/site";

/**
 * Plain text product summary for AI crawlers and answer engines, served at
 * /llms.txt. Kept in sync with the landing copy by reusing the same FAQ source.
 */
function body() {
  const faq = FAQ_ITEMS.map(
    (item) => `### ${item.question}\n\n${item.answer}`,
  ).join("\n\n");

  return `# Tape

> Tape is a meeting workspace for teams that work across Chinese and English. It records meetings, transcribes them without being told which language to expect, keeps Chinese and English side by side, groups recurring meetings into one thread, and exposes the archive to your own AI assistant over MCP.

Tape is open source and self hosted. There are no per-seat licences: you run it on infrastructure you choose and pay those providers directly.

## What makes it different

- No language to select before a meeting. The language is detected from the audio, so a sentence that starts in English and finishes in Mandarin stays one clean line.
- Chinese and English transcripts line for line, with the original always kept beside the translation.
- Recurring meetings are grouped as they arrive, so a weekly sync reads as one running conversation rather than a pile of separate files.
- Capture without a bot in the call: a macOS app records microphone and system audio locally. Calendar based joining of Zoom and Google Meet is optional.
- Read only MCP access, so Claude or Cursor can query the archive directly. The permission boundary is enforced by the database, so an assistant reaches only the meetings its user could open by hand.
- Any meeting exports as plain text, and its audio as an mp3.
- Speakers are separated by voice and named; entities mentioned in the room are detected and linked.

## Questions

${faq}

## Links

- Product: ${siteUrl("/")}
- Source: ${REPOSITORY_URL}
- Privacy: ${siteUrl("/privacy")}
- Terms: ${siteUrl("/terms")}
`;
}

export function GET() {
  return new Response(body(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
