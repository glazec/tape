import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingArchive } from "@/components/landing/landing-archive";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingEnterprise } from "@/components/landing/landing-enterprise";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingIntelligence } from "@/components/landing/landing-intelligence";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingPartners } from "@/components/landing/landing-partners";
import { LandingRecorder } from "@/components/landing/landing-recorder";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tape — Every conversation, on the record",
  description:
    "Tape records, transcribes, and understands your meetings — and you own every word. Search on the web or through MCP, record locally on macOS, and keep the archive in your own workspace.",
};

export default async function LandingPage() {
  const user = await getAuthenticatedUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-paper font-landing text-ink antialiased">
      <LandingNav />
      <LandingHero />
      <LandingPartners />
      <LandingArchive />
      <LandingRecorder />
      <LandingIntelligence />
      <LandingEnterprise />
      <LandingCta />
    </main>
  );
}
