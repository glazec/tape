"use client";

import {
  ArtPanel,
  Container,
  FadeIn,
  Lede,
  SectionHeading,
  TrackLabel,
  type Point,
} from "./landing-section";
import { AgentQueryMockup } from "./mockups";

const POINTS: readonly Point[] = [
  {
    title: "The whole archive, not a search box",
    body: "Meetings, speakers, transcripts, connections, and to-dos are tables your assistant can query, so a question that spans a year is one question.",
  },
  {
    title: "Ask in English, find it in Mandarin",
    body: "Every word and speaker in either language is searchable, and every answer links back to the second it was said.",
  },
  {
    title: "It only sees what you can see",
    body: "Queries are read only and scoped to your access by the database itself, not by the wording of a prompt.",
  },
];

/**
 * The split track: copy and a numbered list on one side, the painted panel on
 * the other, so A4 does not repeat the stacked shape of A1 and A3.
 */
export function LandingAgents() {
  return (
    <section id="agents" className="scroll-mt-20 bg-paper">
      <Container className="grid gap-x-16 gap-y-12 py-20 [&>*]:min-w-0 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-center lg:py-28">
        <FadeIn>
          <TrackLabel track="A4">Agents</TrackLabel>
          <SectionHeading className="mt-6">
            Every meeting,
            <br />
            <em className="italic">one question away.</em>
          </SectionHeading>
          <Lede>
            Tape opens your whole meeting database to the AI you already use,
            over MCP. Ask in plain words; it writes the query and brings back
            the moments.
          </Lede>
          <ol className="mt-10 flex flex-col gap-6">
            {POINTS.map((point, index) => (
              <li key={point.title} className="flex gap-5">
                <span className="font-mono text-label tabular-nums leading-7 text-brand-ink">
                  0{index + 1}
                </span>
                <div>
                  <p className="text-[1.125rem] font-semibold leading-7 tracking-[-0.01em] text-ink">
                    {point.title}
                  </p>
                  <p className="mt-1.5 max-w-[40ch] text-[1rem] leading-[1.65] text-pretty text-graphite">
                    {point.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </FadeIn>
        <FadeIn delay={0.1}>
          <ArtPanel src="/media/art/assistant.webp" className="min-h-[34rem]">
            <AgentQueryMockup />
          </ArtPanel>
        </FadeIn>
      </Container>
    </section>
  );
}
