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
    question: "What does Tape write after a meeting?",
    answer:
      "A follow-up in four parts: a to-do list with a name on every action, the dynamic of the call (who offered what and who needs what), potential connections grouped by the person who mentioned them, and up to five open research questions. Every item links to the line of transcript it came from, and any research question copies out as a ready prompt for your own research tool.",
  },
  {
    question: "Can my own AI assistant read my meetings?",
    answer:
      "Yes, all of them at once. Tape publishes your meeting database over MCP, so Claude, Cursor, or any MCP client can look up the schema and run read only queries across meetings, speakers, transcripts, and follow-ups, instead of you copying transcripts around. Every query is scoped to your access by the database rather than by the wording of a prompt: an assistant reaches exactly the meetings you could open by hand.",
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
    question: "Can we change how Tape works?",
    answer:
      "Yes, that is the point of the code being public. The prompts that write notes, to-dos, and research questions live in the repository, summaries run through OpenRouter so the model is a setting, and the setup guide covers running your own copy. Tape is released under the Functional Source License (FSL-1.1-ALv2): any team can use, modify, and self-host it, including for work, but not resell it as a competing product or hosted service. Each release becomes Apache 2.0 two years after it ships.",
  },
  {
    question: "How is Tape priced?",
    answer:
      "There are no per-seat licences. You run Tape on your own infrastructure and pay the providers directly for recording, transcription, summaries, database, and hosting, which is what the calculator above estimates. Cost scales with meeting hours rather than headcount.",
  },
];
