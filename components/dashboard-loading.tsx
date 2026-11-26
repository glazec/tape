import { ProductLogo } from "@/components/product-logo";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardPageLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-8 px-4 sm:px-6">
          <ProductLogo />
          <div aria-hidden="true" className="flex items-center gap-6">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-14" />
          </div>
          <Skeleton aria-hidden="true" className="ml-auto h-8 w-28" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
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
      className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-10"
      role="status"
    >
      <DashboardStatsSkeleton />
      <DashboardCalendarSkeleton />
      <span className="sr-only">Loading dashboard overview</span>
    </div>
  );
}

export function DashboardStatsSkeleton() {
  return (
    <div aria-hidden="true" className="min-w-0">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
    </div>
  );
}

export function DashboardCalendarSkeleton() {
  return (
    <div aria-hidden="true" className="flex items-center gap-6">
      <div>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="h-8 w-32" />
    </div>
  );
}

export function MeetingLibrarySkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading meetings"
      className="flex flex-col pt-4"
      role="status"
    >
      <Skeleton className="h-6 w-24" />
      <div aria-hidden="true" className="grid gap-2 pt-4 pb-3 md:grid-cols-[minmax(12rem,1fr)_11rem_auto]">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-20" />
      </div>
      <div aria-hidden="true" className="divide-y divide-border/50">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="flex items-center gap-4 py-3.5 pl-8" key={index}>
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </div>
            <Skeleton className="hidden h-4 w-28 md:block" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading meetings</span>
    </section>
  );
}

export function MeetingLibraryRowsScaffold({ rowCount }: { rowCount: number }) {
  return (
    <div aria-label="Loading meeting details" aria-busy="true" role="status">
      <div aria-hidden="true" className="pt-8 pb-2">
        <Skeleton className="h-4 w-20" />
      </div>
      <div aria-hidden="true">
        {Array.from({ length: rowCount }, (_, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_7rem] px-2 py-3 md:grid-cols-[7rem_minmax(0,1fr)_7rem] md:pl-0">
            <Skeleton className="mt-0.5 hidden h-4 w-16 md:block" />
            <div className="px-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="mt-1 h-3 w-28 max-w-full" />
            </div>
            <Skeleton className="ml-auto mr-2 h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
