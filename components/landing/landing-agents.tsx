"use client";

import {
  Container,
  FadeIn,
  Lede,
  SectionHeading,
  SectionLabel,
  type Point,
} from "./landing-section";

const POINTS: readonly Point[] = [
  {
    title: "Your assistant, not ours",
    body: "Tape publishes your archive over MCP, so Claude, Cursor, or whatever you already work in can query it directly. Read only, and scoped to what you are allowed to see.",
  },
  {
    title: "Search that reaches every word",
    body: "Full text across transcripts, speakers, titles, and detected entities on the web too, with the recording one click from any result.",
  },
  {
    title: "Yours to keep",
    body: "Recordings, transcripts, and audio stay in your workspace. Exportable whenever you want them, and never used to train public models.",
  },
];

const RESULTS = [
  { title: "Weekly partner sync", when: "Jul 16", at: "12:04" },
  { title: "Platform design review", when: "Jul 09", at: "27:41" },
  { title: "Security questionnaire walkthrough", when: "Jun 30", at: "08:15" },
];

export function LandingAgents() {
  return (
    <section id="agents" className="border-b border-ink/8 bg-paper">
      <Container className="py-20 lg:py-28">
        <div className="grid items-end gap-x-16 gap-y-10 [&>*]:min-w-0 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
          <FadeIn>
            <SectionLabel>04 · Agents</SectionLabel>
            <SectionHeading>
              Your archive,
              <br />
              <em className="italic text-graphite">in your assistant.</em>
            </SectionHeading>
            <Lede>
              Every notetaker now has a chatbot of its own. Tape takes the other
              route: it hands the whole archive to the assistant you already
              trust, and keeps the data on your side of the line.
            </Lede>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="rounded-xl border border-ink/10 bg-mist/70 p-6 font-mono text-[0.8125rem] leading-6 sm:p-7">
              <p className="text-graphite">
                <span className="text-brand-ink">you</span> · ask your assistant
              </p>
              <p className="mt-2 text-ink">
                Where did we agree the security review lands?
              </p>
              <p className="mt-6 text-ash">
                <span className="text-brand-ink">tape</span> · 3 meetings
                matched
              </p>
              <ul className="mt-2 flex flex-col gap-1.5 tabular-nums">
                {RESULTS.map((result) => (
                  <li
                    key={result.title}
                    className="flex items-baseline justify-between gap-4 text-ink"
                  >
                    <span className="min-w-0 truncate">{result.title}</span>
                    <span className="shrink-0 text-graphite">
                      {result.when} · {result.at}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </FadeIn>
        </div>
        <dl className="mt-16 grid gap-x-14 gap-y-10 border-t border-ink/8 pt-10 md:grid-cols-3">
          {POINTS.map((point, index) => (
            <FadeIn key={point.title} delay={index * 0.08}>
              <dt className="text-[0.9375rem] font-medium leading-6 text-ink">
                {point.title}
              </dt>
              <dd className="mt-2 max-w-[42ch] text-[0.9375rem] leading-[1.7] text-pretty text-graphite">
                {point.body}
              </dd>
            </FadeIn>
          ))}
        </dl>
      </Container>
    </section>
  );
}
