import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FAQ_ITEMS } from "@/components/landing/faq-items";
import { LandingAgents } from "@/components/landing/landing-agents";
import { LandingCapture } from "@/components/landing/landing-capture";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingFollowup } from "@/components/landing/landing-followup";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingLanguages } from "@/components/landing/landing-languages";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingPricing } from "@/components/landing/landing-pricing";
import { LandingOpenSource } from "@/components/landing/landing-open-source";
import { LandingThesis } from "@/components/landing/landing-thesis";
import { readGithubActivity } from "@/lib/github-activity";
import { getAuthenticatedUser } from "@/lib/auth";
import { readPricingCalendarEstimate } from "@/lib/pricing-calendar-server";
import { REPOSITORY_URL, SITE_NAME, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Open source meeting memory for bilingual teams. Records calls and rooms in Chinese and English, then writes to-dos, connections, and research your AI can read.";
const SOCIAL_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Tape meeting workspace with bilingual transcript and AI answers",
};

export const metadata: Metadata = {
  title: "It’s all on Tape — bilingual meeting memory",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl("/"),
    siteName: SITE_NAME,
    locale: "en_US",
    title: "It’s all on Tape — bilingual meeting memory",
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "It’s all on Tape — bilingual meeting memory",
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

/**
 * Emitted so search and answer engines read the product and its answers from
 * the same copy the page shows, rather than guessing from the marketing prose.
 */
function structuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "macOS, Web",
        url: siteUrl("/"),
        description: DESCRIPTION,
        isAccessibleForFree: true,
        featureList: [
          "Automatic language detection with no language to select before a meeting",
          "Chinese and English transcripts side by side, line for line",
          "Follow-ups with connections, room dynamic, to-dos, and open research questions",
          "macOS recorder for in-person meetings with no bot",
          "Meeting bots, local Mac recording, and voice recorder uploads in one app",
          "Multi-tenant workspaces on one self-hosted deployment",
          "Whole meeting database queryable by your own AI assistant over MCP",
          "Open source, self-hostable on your own infrastructure",
          "Plain text and mp3 export of any meeting",
        ],
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description:
            "Self hosted with no per-seat licence. You pay your own infrastructure providers for recording, transcription, summaries, database, and hosting.",
        },
        codeRepository: REPOSITORY_URL,
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ_ITEMS.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect("/dashboard");
  }

  // The anonymous calendar connect flow returns to /?calendar=<status>#pricing.
  // Reading it here keeps the pricing section's first render correct.
  const calendarStatus = searchParams
    ? (await searchParams).calendar
    : undefined;
  const normalizedCalendarStatus =
    typeof calendarStatus === "string" ? calendarStatus : null;
  // Building the estimate here means the browser never handles the token or a
  // loading state; it receives finished aggregates or an error message.
  const [calendarEstimate, githubActivity] = await Promise.all([
    normalizedCalendarStatus === "connected"
      ? readPricingCalendarEstimate()
      : null,
    readGithubActivity(),
  ]);

  return (
    <main className="min-h-screen bg-paper font-landing text-ink antialiased">
      <script
        type="application/ld+json"
        // Serialized from a local literal, so there is no untrusted input here.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <LandingNav />
      <LandingHero activity={githubActivity} />
      <LandingThesis />
      <LandingFollowup />
      <LandingLanguages />
      <LandingCapture />
      <LandingAgents />
      <LandingOpenSource activity={githubActivity} />
      <LandingPricing
        calendarStatus={normalizedCalendarStatus}
        calendarEstimate={calendarEstimate}
      />
      <LandingFaq />
      <LandingCta />
    </main>
  );
}
