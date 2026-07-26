import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LandingAgents } from "@/components/landing/landing-agents";
import { LandingCapture } from "@/components/landing/landing-capture";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingEnterprise } from "@/components/landing/landing-enterprise";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingLanguages } from "@/components/landing/landing-languages";
import { LandingMemory } from "@/components/landing/landing-memory";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingPartners } from "@/components/landing/landing-partners";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tape — Every conversation, on the record",
  description:
    "Tape records your meetings with calendar bots and a local macOS recorder, transcribes and translates them across 30+ languages, groups recurring calls into one thread, and lets your own AI assistant query the archive over MCP. Your workspace, your data.",
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
      <LandingCapture />
      <LandingLanguages />
      <LandingMemory />
      <LandingAgents />
      <LandingEnterprise />
      <LandingCta />
    </main>
  );
}
