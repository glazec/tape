/**
 * Shared by the FAQ section and the FAQPage structured data in app/page.tsx,
 * so the answers an answer engine quotes are the same ones on the page.
 */
export const FAQ_ITEMS: readonly { question: string; answer: string }[] = [
  {
    question: "Does a bot join my meetings?",
    answer:
      "Only if you ask it to. The macOS app records your microphone and system audio on your own machine, so nothing joins the call and nothing announces itself. Connecting a calendar so Tape can attend Zoom and Google Meet on your behalf is a separate choice you make, and you can leave it off.",
  },
  {
    question: "Which languages does Tape handle?",
    answer:
      "You never tell Tape what language a meeting will be in. It is detected from the audio, so a sentence that starts in English and finishes in Mandarin comes back as one clean line instead of phonetic guesswork. Transcripts can then be read with Chinese and English side by side, line for line.",
  },
  {
    question: "Can my own AI assistant read my meetings?",
    answer:
      "Yes. Tape publishes your archive over MCP, so Claude, Cursor, or whatever you already work in can query it directly instead of you copying transcripts around. Access is read only, and the permission boundary is enforced by the database rather than by the wording of a prompt: an assistant reaches exactly the meetings you could open by hand.",
  },
  {
    question: "Who can see a meeting I record?",
    answer:
      "Each team gets its own archive, its own members, and its own calendar connections. People outside the workspace see only what you hand them, through links you can set to expire, and nothing else in the archive.",
  },
  {
    question: "Can I get my transcripts out again?",
    answer:
      "Any meeting exports as plain text, and its audio as an mp3, whenever you want it. Tape is open source and runs on infrastructure you choose, so the recordings and the database stay on your side of the line and are never handed to third parties to train on.",
  },
  {
    question: "How is Tape priced?",
    answer:
      "There are no per-seat licences. You run Tape on your own infrastructure and pay the providers directly for recording, transcription, summaries, database, and hosting, which is what the calculator above estimates. Cost scales with meeting hours rather than headcount.",
  },
];
