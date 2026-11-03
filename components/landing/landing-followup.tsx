"use client";

import {
  ArtPanel,
  Container,
  FadeIn,
  Lede,
  SectionHeading,
  TrackLabel,
} from "./landing-section";
import { FollowupMockup } from "./mockups";

/**
 * The four parts of the follow-up Tape writes after every call. Each one is a
 * real section of the product's follow-up panel, in the same order.
 */
const PARTS = [
  {
    title: "Connections",
    body: "Every person, team, and project someone said they know, grouped by who said it.",
  },
  {
    title: "Room dynamic",
    body: "Who offered help, who needs it, and where the conversation leaned.",
  },
  {
    title: "To do",
    body: "Every promise made out loud, with a name on it and the second it was said.",
  },
  {
    title: "Research",
    body: "The questions nobody could answer yet, one click from a ready research prompt.",
  },
] as const;

export function LandingFollowup() {
  return (
    <section id="followup" className="scroll-mt-20 bg-paper">
      <Container className="py-20 lg:py-28">
        <FadeIn className="mx-auto max-w-[44rem] text-center">
          <TrackLabel track="A1" className="justify-center">
            After the call
          </TrackLabel>
          <SectionHeading className="mt-6">
            Who knows whom.
            <br />
            <em className="italic">Who owes what.</em>
          </SectionHeading>
          <Lede className="mx-auto">
            After every call, Tape writes down the introductions offered, the
            promises made, and the questions left open, each linked to the
            moment it was said.
          </Lede>
        </FadeIn>

        <FadeIn delay={0.05}>
          <div className="mx-auto mt-12 grid max-w-[56rem] items-center gap-x-10 gap-y-3 rounded-[1.25rem] bg-mist px-7 py-7 [&>*]:min-w-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-10 sm:py-8">
            <p className="font-display text-[clamp(3.5rem,2.6rem+3vw,5rem)] leading-none tracking-[-0.03em] text-brand">
              90%
            </p>
            <div>
              <p className="text-[1.0625rem] font-medium leading-[1.45] text-pretty text-ink">
                of the introductions our team asks for go through, when the
                person came up in a call or a meetup.
              </p>
              <p className="mt-2 text-[0.9375rem] leading-[1.65] text-pretty text-graphite">
                Someone named in conversation arrives with context and a person
                who already vouched for them. A cold message, or a contact
                synced into a CRM, has neither. That is why Tape keeps track of
                who knows whom.
              </p>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <ArtPanel
            src="/media/art/archive.webp"
            plainOnPhone
            className="mt-10 lg:mt-12"
          >
            <div className="w-full max-w-[46rem]">
              <FollowupMockup />
            </div>
          </ArtPanel>
        </FadeIn>

        <FadeIn delay={0.15}>
          <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {PARTS.map((part) => (
              <div key={part.title}>
                <dt className="text-[1.125rem] font-semibold leading-7 tracking-[-0.01em] text-ink">
                  {part.title}
                </dt>
                <dd className="mt-1.5 text-[0.9375rem] leading-[1.65] text-pretty text-graphite">
                  {part.body}
                </dd>
              </div>
            ))}
          </dl>
        </FadeIn>

        <FadeIn delay={0.2}>
          <div className="mt-16">
            <div className="grid gap-x-12 gap-y-4 rounded-[1.25rem] bg-ink px-7 py-8 text-paper [&>*]:min-w-0 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end">
              <div>
                <p className="inline-flex items-center gap-2 font-mono text-label uppercase tracking-[0.2em] text-paper/60">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-brand"
                  />
                  Next on the tape
                </p>
                <p className="font-display mt-5 max-w-[18ch] text-display-3 tracking-[-0.02em] text-balance">
                  Questions that research{" "}
                  <em className="italic text-brand">themselves.</em>
                </p>
              </div>
              <p className="max-w-[44ch] text-[0.9375rem] leading-[1.65] text-pretty text-paper/70">
                Today, each open question copies out as a research prompt with
                the meeting context attached. Next, Tape starts that research on
                its own, and the answer is waiting before your next call.
              </p>
            </div>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
