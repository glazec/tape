import Link from "next/link";
import { CheckCircle2, LogIn, Search, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const transcriptRows = [
  {
    title: "Weekly product review",
    meta: "Google Meet, 42 min",
    status: "Ready",
    badge: "default" as const,
  },
  {
    title: "Pipeline sync",
    meta: "Zoom, recording",
    status: "Processing",
    badge: "secondary" as const,
  },
  {
    title: "Customer call upload",
    meta: "Audio upload, 28 min",
    status: "Ready",
    badge: "default" as const,
  },
];

const metrics = [
  { label: "Default access", value: "Organization" },
  { label: "Share options", value: "Link or email" },
  { label: "External access", value: "Read only" },
];

const workflowSteps = [
  "Bot joins",
  "Transcript ready",
  "Team reviews",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--background)_0%,var(--surface)_100%)] text-foreground">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground shadow-sm"
            >
              MT
            </span>
            <span>Meeting Transcript</span>
          </Link>
          <Link
            href="/auth/sign-in"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:py-16">
        <div>
          <p className="text-sm font-medium uppercase tracking-normal text-primary">
            Team transcript workspace
          </p>
          <h1 className="mt-4 max-w-2xl text-5xl font-semibold leading-[1.02] sm:text-6xl">
            Meeting Transcript
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Record Google Meet and Zoom calls, upload recordings, and keep every
            transcript available only to your organization or the people you
            explicitly share with.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/auth/sign-in"
              className={cn(buttonVariants({ size: "lg" }), "w-fit")}
            >
              <LogIn data-icon="inline-start" />
              Sign in with Google
            </Link>
            <Link
              href="/auth/sign-in"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "w-fit",
              )}
            >
              Open workspace
            </Link>
          </div>

          <dl className="mt-10 grid gap-3 sm:grid-cols-3">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border bg-card/80 p-3 shadow-sm"
              >
                <dt className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                  {metric.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold">{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Card className="shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <CardHeader className="border-b bg-muted/35">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Transcript queue</CardTitle>
                <CardDescription>
                  Live recording, upload, and access status in one place.
                </CardDescription>
              </div>
              <div
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <Search className="size-4" />
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-3">
              {workflowSteps.map((step, index) => (
                <div key={step} className="flex items-center gap-2 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="font-medium">{step}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="home-search">Search transcripts</Label>
              <Input
                id="home-search"
                type="search"
                placeholder="Search title, speaker, or transcript"
                className="bg-background"
              />
            </div>

            <div className="divide-y overflow-hidden rounded-lg border bg-background">
              {transcriptRows.map((row) => (
                <div
                  key={row.title}
                  className="grid gap-4 px-5 py-4 transition-colors hover:bg-muted/40 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1 flex size-2.5 shrink-0 rounded-full bg-primary"
                    />
                    <div>
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {row.meta}
                      </p>
                    </div>
                  </div>
                  <Badge variant={row.badge} className="w-fit">
                    {row.status}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="grid gap-4 rounded-lg border bg-muted/45 p-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">
                    Internal attendee access
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Meeting participants get access only when they match workspace
                    membership.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Share controls</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Publish a meeting URL, select a coworker, or add an email for
                    read only transcript access.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
