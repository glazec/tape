import { ProductLogo } from "@/components/product-logo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardPageLoading() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--background)_0%,var(--surface)_100%)] text-foreground">
      <header className="border-b border-border/70 bg-background/85">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
          <ProductLogo />
          <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border bg-card p-1">
              <Skeleton className="h-11 w-28 sm:h-8" />
              <Skeleton className="h-11 w-24 sm:h-8" />
              <Skeleton className="h-11 w-28 sm:h-8" />
            </div>
            <Skeleton className="h-11 w-24 sm:h-8" />
            <Skeleton className="h-11 w-20 sm:h-8" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
        <section
          aria-busy="true"
          aria-label="Loading dashboard"
          className="flex flex-col gap-6"
        >
          <DashboardOverviewSkeleton />
          <MeetingLibrarySkeleton />
        </section>
      </main>
    </div>
  );
}

export function DashboardOverviewSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard overview"
      className="grid gap-4 lg:grid-cols-2"
      role="status"
    >
      <Card className="min-h-36 lg:row-span-2 lg:min-h-60">
        <CardContent className="flex flex-1 flex-col justify-center py-6 sm:px-7 sm:py-7">
          <Skeleton className="h-8 w-3/5 max-w-72" />
          <Skeleton className="mt-3 h-5 w-2/5 max-w-52" />
        </CardContent>
      </Card>
      <DashboardCardSkeleton />
      <DashboardCardSkeleton compact />
      <span className="sr-only">Loading dashboard overview</span>
    </div>
  );
}

export function MeetingLibrarySkeleton() {
  return (
    <Card
      aria-busy="true"
      aria-label="Loading meetings"
      className="gap-0 py-0 shadow-sm"
      role="status"
    >
      <CardHeader className="border-b bg-muted/25 px-4 py-4 sm:px-5">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-col px-0">
        <div
          aria-hidden="true"
          className="grid gap-3 border-b bg-muted/20 px-4 py-3 sm:px-5 md:grid-cols-[minmax(12rem,1fr)_10rem_auto] md:items-end"
        >
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-24" />
        </div>
        <div aria-hidden="true" className="divide-y">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              className="flex min-h-20 items-center gap-4 px-4 py-4 sm:px-5"
              key={index}
            >
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="mt-2 h-3 w-3/5" />
              </div>
              <Skeleton className="hidden h-6 w-16 sm:block" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading meetings</span>
      </CardContent>
    </Card>
  );
}

function DashboardCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <Card className={compact ? "min-h-36" : "min-h-32"}>
      <CardHeader className={compact ? "border-b bg-muted/35" : undefined}>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}
