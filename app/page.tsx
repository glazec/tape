import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FAQ_ITEMS } from "@/components/landing/faq-items";
import { LandingAgents } from "@/components/landing/landing-agents";
import { LandingCapture } from "@/components/landing/landing-capture";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingEnterprise } from "@/components/landing/landing-enterprise";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingLanguages } from "@/components/landing/landing-languages";
import { LandingLaunchFilm } from "@/components/landing/landing-launch-film";
import { LandingMemory } from "@/components/landing/landing-memory";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingPartners } from "@/components/landing/landing-partners";
import { LandingPricing } from "@/components/landing/landing-pricing";
import { getAuthenticatedUser } from "@/lib/auth";
import { REPOSITORY_URL, SITE_NAME, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Bilingual meeting notes for Chinese–English teams. Auto-threaded recurring meetings and an AI assistant that queries your full archive via MCP.";
const SOCIAL_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "Tape meeting workspace with bilingual transcript and AI answers",
};

export const metadata: Metadata = {
  title: "Tape — Every conversation, on the record",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl("/"),
    siteName: SITE_NAME,
    title: "Tape — Every conversation, on the record",
    locale: "en_US",
    description: DESCRIPTION,
  },
    images: [SOCIAL_IMAGE],
  twitter: {
    card: "summary_large_image",
    title: "Tape — Every conversation, on the record",
    description: DESCRIPTION,
  },
    images: [SOCIAL_IMAGE],
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
          "Recurring meetings grouped into a single running thread",
          "Speaker separation with named speakers",
          "Read only MCP access for your own AI assistant",
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

export default async function LandingPage() {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-paper font-landing text-ink antialiased">
      <script
        type="application/ld+json"
        // Serialized from a local literal, so there is no untrusted input here.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <LandingNav />
      <LandingHero />
      <LandingLaunchFilm />
      <LandingPartners />
      <LandingMemory />
      <LandingLanguages />
      <LandingAgents />
      <LandingCapture />
      <LandingEnterprise />
      <LandingPricing />
      <LandingFaq />
      <LandingCta />
    </main>
  );
}
