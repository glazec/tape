"use client";

import { AlertTriangle } from "lucide-react";

export default function DashboardError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 text-ink">
      <div className="w-full max-w-md text-center">
        <AlertTriangle
          aria-hidden
          className="mx-auto size-8 text-destructive"
        />
        <h1 className="font-display mt-5 text-display-3">
          Could not open your dashboard
        </h1>
        <p className="mt-3 leading-7 text-graphite">
          Try loading the page again. Your sign in has been kept.
        </p>
        <button
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-6 font-medium text-paper"
          type="button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
