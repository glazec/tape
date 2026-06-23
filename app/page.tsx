import Link from "next/link";
import { LogIn } from "lucide-react";

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
    meta: "MP3 upload, 28 min",
    status: "Ready",
    badge: "default" as const,
  },
];

const metrics = [
  { label: "Internal members", value: "24" },
  { label: "Sources", value: "Meet, Zoom, MP3" },
  { label: "Storage", value: "Cloud" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold">
            Meeting Transcript
          </Link>
          <Link
            href="/auth/sign-in"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-16">
        <div>
          <p className="text-sm font-medium uppercase tracking-normal text-primary">
            Team transcript workspace
          </p>
          <h1 className="mt-4 max-w-2xl text-5xl font-semibold leading-tight sm:text-6xl">
            Meeting Transcript
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Record Google Meet and Zoom calls, upload MP3 files, and keep every
            transcript available only to the right internal workspace members.
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

          <dl className="mt-10 grid grid-cols-3 gap-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="border-t pt-4">
                <dt className="text-sm text-muted-foreground">
                  {metric.label}
                </dt>
                <dd className="mt-1 text-base font-semibold">{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Transcript queue</CardTitle>
            <CardDescription>
              Live recording, upload, and access status in one place.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="home-search">Search transcripts</Label>
              <Input
                id="home-search"
                type="search"
                placeholder="Search title, speaker, or transcript"
              />
            </div>

            <div className="divide-y rounded-lg border">
              {transcriptRows.map((row) => (
                <div
                  key={row.title}
                  className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="flex items-start gap-3">
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

            <div className="grid gap-4 rounded-lg bg-muted p-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">
                  Internal attendee access
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Meeting participants get access only when they match workspace
                  membership.
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold">Share controls</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Share transcripts with managed links after processing
                  finishes.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
